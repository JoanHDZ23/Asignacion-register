import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Icon, Modal } from '../components'
import {
  apiRequest,
  type BiometricStatusResponse,
  type CompanyManagementResponse,
  type LocationResponse,
  type TurnResponse,
  type UserResponse,
  type VerifyAttendanceResponse,
  type VerifyBiometricRegistrationResponse,
} from '../lib/api'
import { getCurrentToken, getCurrentUser } from '../lib/auth-storage'

type TurnAssignment = {
  id: string
  fecha: string
  horario: string
  titulo: string
  descripcion: string
  asignadoA: string
  assignedToUserId?: string
  ubicacion: string
  locationId?: string
  locationUrl?: string
  confirmedDeadline?: string   // ISO — límite para confirmar
  estado: 'pendiente' | 'asignado' | 'en_proceso' | 'finalizado' | 'confirmado' | 'rechazado'
  attendance?: TurnResponse['attendance']
}

function mapTurns(response: TurnResponse[], locationMap: Map<string, LocationResponse> = new Map()): TurnAssignment[] {
  return response.map((turn) => {
    const loc = turn.locationId ? locationMap.get(turn.locationId) : undefined
    const locationUrl = loc?.latitud && loc?.longitud
      ? `https://www.google.com/maps?q=${loc.latitud},${loc.longitud}`
      : undefined
    return {
      id: turn.id,
      fecha: turn.fecha,
      horario: turn.horaFin ? `${turn.hora} - ${turn.horaFin}` : turn.hora,
      titulo: turn.titulo,
      descripcion: turn.descripcion ?? '-',
      asignadoA: turn.assignedToUserName ?? turn.assignedToUserId ?? 'Sin asignar',
      assignedToUserId: turn.assignedToUserId,
      ubicacion: turn.locationNombre ?? turn.locationId ?? 'Sin ubicacion',
      locationId: turn.locationId,
      locationUrl,
      confirmedDeadline: turn.confirmedDeadline,
      estado: turn.estado,
      attendance: turn.attendance,
    }
  })
}

type BiometricFeedback = { kind: 'idle' | 'success' | 'error'; message?: string }

type AvailableWorker = { id: string; nombreCompleto: string; cargo: string }

/** Devuelve los minutos restantes hasta el deadline. Negativo si ya expiró. */
function minutesUntilDeadline(deadline: string): number {
  return Math.floor((new Date(deadline).getTime() - Date.now()) / 60_000)
}

/** Formatea el countdown: "3h 45m" o "45m" o "Expirado". */
function fmtCountdown(mins: number): string {
  if (mins <= 0) return 'Expirado'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** Determina si la ventana de confirmación aún está abierta. */
function isWithinConfirmWindow(deadline: string | undefined): boolean {
  if (!deadline) return true   // turnos sin deadline (legacy) → siempre abiertos
  return minutesUntilDeadline(deadline) > 0
}

// ── Utilidades de cálculo de horas ──────────────────────────────────────────

/**
 * Devuelve las horas trabajadas en un turno.
 * REGLAS:
 * - Solo cuenta si el turno está confirmado o finalizado (supervisor aprobó el ingreso).
 * - Si el empleado marcó entrada pero el supervisor no confirmó → 0h (no cuenta).
 * - Si está finalizado con checkIn+checkOut reales → usa la diferencia real.
 * - Si está confirmado sin checkOut → se detiene en horaFin programada (auto-salida).
 */
function calcTurnHours(turn: TurnAssignment): number {
  const att = turn.attendance
  const estado = turn.estado

  // No cuenta si no fue confirmado/finalizado por el supervisor
  if (estado !== 'confirmado' && estado !== 'finalizado') return 0

  const checkInTime = att?.checkIn?.markedAt ? new Date(att.checkIn.markedAt).getTime() : null
  if (!checkInTime) return 0

  // Si hay checkOut real → usa la diferencia real
  if (att?.checkOut?.markedAt) {
    const diff = new Date(att.checkOut.markedAt).getTime() - checkInTime
    return diff > 0 ? diff / 3_600_000 : 0
  }

  // Sin checkOut → auto-salida a la horaFin programada
  // Extrae horaFin del campo horario ("HH:MM - HH:MM") o del turno directamente
  const parts = turn.horario.split(' - ')
  const horaFinStr = parts[1]?.trim()
  const fechaStr   = turn.fecha

  if (horaFinStr && fechaStr) {
    const [eh, em] = horaFinStr.split(':').map(Number)
    if (!Number.isNaN(eh) && !Number.isNaN(em)) {
      const scheduledEnd = new Date(`${fechaStr}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00`).getTime()
      // Usa el menor entre ahora y la hora de fin programada
      const effectiveEnd = Math.min(scheduledEnd, Date.now())
      const diff = effectiveEnd - checkInTime
      return diff > 0 ? diff / 3_600_000 : 0
    }
  }

  return 0
}

/** Indica si el turno necesita confirmación pendiente del supervisor (rojo). */
function needsSupervisorConfirm(turn: TurnAssignment): boolean {
  return Boolean(
    turn.attendance?.checkIn?.markedAt &&
    turn.estado === 'en_proceso'   // marcó entrada pero supervisor no confirmó
  )
}

/** Formatea un número de horas a "Xh Ym". */
function fmtHours(h: number): string {
  const totalMin = Math.round(h * 60)
  const hrs = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (hrs === 0) return `${min}m`
  return min === 0 ? `${hrs}h` : `${hrs}h ${min}m`
}

/** Agrupa una lista de turnos por día (YYYY-MM-DD) sumando horas. */
function groupByDay(turns: TurnAssignment[]): { fecha: string; hours: number; count: number }[] {
  const map = new Map<string, { hours: number; count: number }>()
  for (const t of turns) {
    const cur = map.get(t.fecha) ?? { hours: 0, count: 0 }
    map.set(t.fecha, { hours: cur.hours + calcTurnHours(t), count: cur.count + 1 })
  }
  return [...map.entries()]
    .map(([fecha, v]) => ({ fecha, ...v }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/** Agrupa por mes (YYYY-MM) sumando horas. */
function groupByMonth(turns: TurnAssignment[]): { mes: string; hours: number; count: number }[] {
  const map = new Map<string, { hours: number; count: number }>()
  for (const t of turns) {
    const mes = t.fecha.slice(0, 7)
    const cur = map.get(mes) ?? { hours: 0, count: 0 }
    map.set(mes, { hours: cur.hours + calcTurnHours(t), count: cur.count + 1 })
  }
  return [...map.entries()]
    .map(([mes, v]) => ({ mes, ...v }))
    .sort((a, b) => a.mes.localeCompare(b.mes))
}

/** Nombre legible del mes: "Jul 2026". */
function fmtMes(yyyymm: string): string {
  const [y, m] = yyyymm.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return new Intl.DateTimeFormat('es-CO', { month: 'short', year: 'numeric' }).format(d)
}

async function getCurrentCoordinates() {
  if (typeof window === 'undefined' || !navigator.geolocation) {
    throw new Error('El navegador no permite obtener la ubicacion actual.')
  }
  return new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => reject(new Error('Debes permitir la ubicacion para validar el punto de trabajo.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  })
}

export default function TurnAssignmentsPage() {
  const currentUser = getCurrentUser()
  const isAdmin = currentUser?.role === 'admin'
  // Supervisor: rol exacto 'supervisor' O cargo que contenga la palabra "supervisor"
  const isSupervisor = currentUser?.role === 'supervisor'
    || (currentUser?.role !== 'admin' && currentUser?.cargo?.toLowerCase().includes('supervisor'))
  const canManageTurns = isAdmin || isSupervisor
  const currentUserId = currentUser?.id

  const [turns, setTurns] = useState<TurnAssignment[]>([])
  const [workers, setWorkers] = useState<UserResponse[]>([])
  const [locations, setLocations] = useState<LocationResponse[]>([])
  const [error, setError] = useState<string | null>(null)
  const [biometricStatus, setBiometricStatus] = useState<BiometricStatusResponse>({
    biometricConfigured: false,
    credentialCount: 0,
  })
  const [biometricFeedback, setBiometricFeedback] = useState<BiometricFeedback>({ kind: 'idle' })
  const [isBiometricBusy, setIsBiometricBusy] = useState(false)
  const [attendanceLoadingId, setAttendanceLoadingId] = useState<string | null>(null)
  const [statusLoadingId, setStatusLoadingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [fecha, setFecha] = useState('')
  const [estado, setEstado] = useState('')
  const [responsable, setResponsable] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({
    assignedToUserIds: [] as string[],
    titulo: 'Manana', fecha: '',
    hora: '06:00', horaFin: '14:00', locationId: '', descripcion: '',
  })

  // Reloj para actualizar countdowns cada minuto
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Modal de reasignación (admin)
  const [reassignModal, setReassignModal] = useState<{
    open: boolean
    turn: TurnAssignment | null
    available: AvailableWorker[]
    loading: boolean
    selectedWorkerId: string
    feedback: string | null
  }>({ open: false, turn: null, available: [], loading: false, selectedWorkerId: '', feedback: null })

  // Modal de detalles del turno (supervisor: ver compañeros y confirmar llegada)
  const [detailModal, setDetailModal] = useState<{ open: boolean; turn: TurnAssignment | null }>({ open: false, turn: null })

  // Estado de captura facial — preview antes de confirmar
  const [facialModal, setFacialModal] = useState<{
    open: boolean
    turn: TurnAssignment | null
    action: 'entrada' | 'salida' | null
    previewUrl: string | null
    photoData: { base64: string; mimeType: string } | null
    capturing: boolean
    locationCheck: { distance: number; allowed: number; withinRange: boolean; name: string } | null
    checkingLocation: boolean
  }>({ open: false, turn: null, action: null, previewUrl: null, photoData: null, capturing: false, locationCheck: null, checkingLocation: false })
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Detiene la cámara al cerrar el modal facial
  const stopFacialStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  const loadTurns = async () => {
    const token = getCurrentToken()
    if (!token) return
    try {
      // Admin: usa /companies/management para tener todos los datos (workers, locations, etc.)
      if (isAdmin) {
        const response = await apiRequest<CompanyManagementResponse>('/companies/management', { token })
        const locMap = new Map(response.locations.map((l) => [l.id, l]))
        setTurns(mapTurns(response.turns, locMap))
        setWorkers(response.users.filter((u) => u.role === 'operativo'))
        setLocations(response.locations)
        setError(null)
        return
      }
      // Supervisor y operativo: /turns ya viene filtrado por el backend según el rol
      const [turnsRes, locsRes] = await Promise.all([
        apiRequest<TurnResponse[]>('/turns', { token }),
        apiRequest<LocationResponse[]>('/locations', { token }).catch(() => [] as LocationResponse[]),
      ])
      const locMap = new Map(locsRes.map((l) => [l.id, l]))
      setLocations(locsRes)
      setTurns(mapTurns(turnsRes, locMap))
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No fue posible obtener los turnos.')
    }
  }

  const loadBiometricStatus = async () => {
    const token = getCurrentToken()
    if (!token || isAdmin) return
    try {
      const response = await apiRequest<BiometricStatusResponse>('/attendance/biometric-status', { token })
      setBiometricStatus(response)
    } catch { /* no crítico */ }
  }

  useEffect(() => { void loadTurns() }, [isAdmin])
  useEffect(() => { void loadBiometricStatus() }, [isAdmin])

  // ── Derivados de turnos (el array 'turns' ya viene filtrado del backend por rol) ──

  // Mis propios turnos (operativo y supervisor tienen los suyos en 'turns')
  const myTurns = useMemo(
    () => turns.filter((t) => t.assignedToUserId === currentUserId),
    // 'now' fuerza recalculo cada 30s para actualizar countdowns
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUserId, turns, now]
  )

  // LocationIds asignadas al supervisor (de sus propios turnos)
  const supervisorLocationIds = useMemo(
    () => new Set(myTurns.map((t) => t.locationId).filter(Boolean) as string[]),
    [myTurns]
  )

  // Compañeros de operación: turnos en las mismas ubicaciones del supervisor, excluyendo los suyos
  const operationTurns = useMemo(() => {
    if (!isSupervisor) return []
    // Si tiene ubicaciones asignadas, filtra por ellas; si no, muestra todos
    const base = supervisorLocationIds.size > 0
      ? turns.filter((t) => t.locationId && supervisorLocationIds.has(t.locationId))
      : turns
    return base.filter((t) => t.assignedToUserId !== currentUserId)
  }, [isSupervisor, turns, currentUserId, supervisorLocationIds])

  // Turnos filtrados para la tabla general (admin y supervisor)
  const filteredTurns = useMemo(() => turns.filter((turn) => {
    const matchesSearch      = search      ? `${turn.asignadoA} ${turn.titulo} ${turn.ubicacion}`.toLowerCase().includes(search.toLowerCase()) : true
    const matchesDate        = fecha       ? turn.fecha === fecha : true
    const matchesStatus      = estado      ? turn.estado === estado : true
    const matchesResponsible = responsable ? turn.asignadoA === responsable : true
    return matchesSearch && matchesDate && matchesStatus && matchesResponsible
  }), [estado, fecha, responsable, search, turns])

  const responsibleOptions = useMemo(
    () => [...new Set(turns.map((t) => t.asignadoA).filter(Boolean))],
    [turns]
  )

  const nextAttendanceAction = (turn: TurnAssignment) => {
    if (!turn.attendance?.checkIn) return 'entrada' as const
    if (!turn.attendance?.checkOut) return 'salida' as const
    return null
  }

  const summaryCards = useMemo(() => [
    { label: 'Programados', value: turns.filter((t) => t.estado === 'pendiente' || t.estado === 'asignado').length, accent: 'blue' },
    { label: 'En curso',    value: turns.filter((t) => t.estado === 'en_proceso').length, accent: 'violet' },
    { label: 'Completados', value: turns.filter((t) => t.estado === 'finalizado').length, accent: 'green' },
    { label: 'Pendientes',  value: turns.filter((t) => t.estado === 'pendiente').length,  accent: 'red' },
  ], [turns])

  // ── Horas por día y mes ─────────────────────────────────────────────────
  // Operativo → sus turnos. Admin/supervisor → turnos visibles de su operación.
  const myHoursBase = useMemo(() => myTurns, [myTurns])   // siempre las horas propias

  // Mes seleccionado para el filtro del resumen diario
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const monthlyHours = useMemo(() => groupByMonth(myHoursBase), [myHoursBase])

  const dailyHours = useMemo(
    () => groupByDay(myHoursBase.filter((t) => t.fecha.startsWith(selectedMonth))),
    [myHoursBase, selectedMonth]
  )

  const totalThisMonth = useMemo(
    () => dailyHours.reduce((acc, d) => acc + d.hours, 0),
    [dailyHours]
  )

  // Para admin/supervisor: tabla de horas por empleado en el mes seleccionado (dentro de su operación)
  const employeeMonthlyHours = useMemo(() => {
    if (!canManageTurns) return []
    const filtered = turns.filter((t) => t.fecha.startsWith(selectedMonth))
    const map = new Map<string, { nombre: string; hours: number; days: Set<string>; turns: number }>()
    for (const t of filtered) {
      const key = t.assignedToUserId ?? t.asignadoA
      const cur = map.get(key) ?? { nombre: t.asignadoA, hours: 0, days: new Set(), turns: 0 }
      cur.hours += calcTurnHours(t)
      cur.days.add(t.fecha)
      cur.turns += 1
      map.set(key, cur)
    }
    return [...map.values()]
      .map((v) => ({ ...v, days: v.days.size }))
      .sort((a, b) => b.hours - a.hours)
  }, [canManageTurns, turns, selectedMonth])

  const handleStatusChange = async (turnId: string, newStatus: 'confirmado' | 'rechazado') => {
    const token = getCurrentToken()
    if (!token) return
    setStatusLoadingId(turnId)
    try {
      await apiRequest<TurnResponse>(`/turns/${turnId}/status`, {
        method: 'PATCH', token, body: { estado: newStatus },
      })
      await loadTurns()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible actualizar el estado.')
    } finally {
      setStatusLoadingId(null)
    }
  }

  /** Abre el modal de reasignación cargando los empleados disponibles. */
  const openReassignModal = async (turn: TurnAssignment) => {
    const token = getCurrentToken()
    if (!token) return
    setReassignModal({ open: true, turn, available: [], loading: true, selectedWorkerId: '', feedback: null })
    try {
      const workers = await apiRequest<AvailableWorker[]>(`/turns/${turn.id}/available-workers`, { token })
      setReassignModal((prev) => ({ ...prev, available: workers, loading: false }))
    } catch {
      setReassignModal((prev) => ({ ...prev, loading: false, feedback: 'No se pudo obtener la lista de empleados.' }))
    }
  }

  /** Confirma la reasignación al empleado seleccionado. */
  const handleReassign = async () => {
    const token = getCurrentToken()
    const { turn, selectedWorkerId } = reassignModal
    if (!token || !turn || !selectedWorkerId) return
    setReassignModal((prev) => ({ ...prev, loading: true, feedback: null }))
    try {
      await apiRequest<TurnResponse>(`/turns/${turn.id}/reassign`, {
        method: 'PATCH', token, body: { newUserId: selectedWorkerId },
      })
      setReassignModal({ open: false, turn: null, available: [], loading: false, selectedWorkerId: '', feedback: null })
      await loadTurns()
    } catch (err) {
      setReassignModal((prev) => ({
        ...prev,
        loading: false,
        feedback: err instanceof Error ? err.message : 'No se pudo reasignar el turno.',
      }))
    }
  }

  const handleResetFilters = () => { setSearch(''); setFecha(''); setEstado(''); setResponsable('') }

  const handleCreateAssignment = async () => {
    const token = getCurrentToken()
    if (!token) return
    if (!createForm.assignedToUserIds.length) {
      setError('Selecciona al menos un empleado.')
      return
    }
    const errors: string[] = []
    let created = 0
    for (const userId of createForm.assignedToUserIds) {
      try {
        await apiRequest<TurnResponse>('/turns', {
          method: 'POST', token,
          body: {
            titulo: createForm.titulo, descripcion: createForm.descripcion,
            fecha: createForm.fecha,   hora: createForm.hora, horaFin: createForm.horaFin,
            assignedToUserId: userId,  locationId: createForm.locationId,
          },
        })
        created++
      } catch {
        const w = workers.find((w) => w.id === userId)
        errors.push(w?.nombreCompleto ?? userId)
      }
    }
    if (created > 0) {
      setShowCreateModal(false)
      setCreateForm({ assignedToUserIds: [], titulo: 'Manana', fecha: '', hora: '06:00', horaFin: '14:00', locationId: '', descripcion: '' })
      await loadTurns()
    }
    if (errors.length) setError(`No se pudo crear turno para: ${errors.join(', ')}.`)
    else setError(null)
  }

  const handleRegisterBiometric = async () => {
    const token = getCurrentToken()
    if (!token) return
    if (!window.PublicKeyCredential) {
      setBiometricFeedback({ kind: 'error', message: 'Este dispositivo no soporta autenticacion biometrica WebAuthn.' })
      return
    }
    setIsBiometricBusy(true)
    setBiometricFeedback({ kind: 'idle' })
    try {
      const options = await apiRequest<Parameters<typeof startRegistration>[0]['optionsJSON']>(
        '/attendance/generate-registration-options', { method: 'POST', token })
      const responseJSON = await startRegistration({ optionsJSON: options })
      const result = await apiRequest<VerifyBiometricRegistrationResponse>(
        '/attendance/verify-registration', { method: 'POST', token, body: { responseJSON } })
      setBiometricStatus({ biometricConfigured: result.biometricConfigured, credentialCount: result.credentialCount })
      setBiometricFeedback({ kind: 'success', message: 'Biometria registrada correctamente. Ya puedes marcar asistencia.' })
    } catch (err) {
      const isCancelled = err instanceof Error && (err.name === 'NotAllowedError' || err.message.toLowerCase().includes('not allowed'))
      setBiometricFeedback({ kind: isCancelled ? 'idle' : 'error', message: isCancelled ? undefined : (err instanceof Error ? err.message : 'No fue posible registrar la biometria.') })
    } finally {
      setIsBiometricBusy(false)
    }
  }

  /** Abre el modal de cámara; el stream se inicia en el useEffect cuando el <video> ya está en el DOM. */
  const openFacialCapture = (turn: TurnAssignment, action: 'entrada' | 'salida') => {
    setFacialModal({ open: true, turn, action, previewUrl: null, photoData: null, capturing: true, locationCheck: null, checkingLocation: true })
  }

  // El <video> siempre está montado en el modal (solo oculto mientras capturing=true).
  // Este effect se dispara cuando el modal se abre para iniciar el stream y verificar ubicación.
  useEffect(() => {
    if (!facialModal.open || !facialModal.capturing) return
    let cancelled = false

    const startStream = async () => {
      // Inicia cámara y verificación de ubicación en paralelo
      const [streamResult, coordsResult] = await Promise.allSettled([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }),
        getCurrentCoordinates(),
      ])
      if (cancelled) {
        if (streamResult.status === 'fulfilled') streamResult.value.getTracks().forEach((t) => t.stop())
        return
      }

      // Asigna stream al <video>
      if (streamResult.status === 'fulfilled') {
        streamRef.current = streamResult.value
        if (videoRef.current) {
          videoRef.current.srcObject = streamResult.value
          videoRef.current.onloadedmetadata = () => { void videoRef.current?.play() }
        }
      }

      // Calcula proximidad si hay coordenadas y la ubicación del turno tiene lat/long
      let locationCheck: typeof facialModal.locationCheck = null
      if (coordsResult.status === 'fulfilled' && facialModal.turn?.locationId) {
        const loc = locations.find((l) => l.id === facialModal.turn?.locationId)
        if (loc?.latitud && loc.longitud) {
          const lat1 = parseFloat(loc.latitud)
          const lon1 = parseFloat(loc.longitud)
          const { latitude: lat2, longitude: lon2 } = coordsResult.value
          const R = 6371000
          const dLat = ((lat2 - lat1) * Math.PI) / 180
          const dLon = ((lon2 - lon1) * Math.PI) / 180
          const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
          const distance = Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
          const allowed = Number(loc.radioTolerancia ?? 100)
          locationCheck = { distance, allowed, withinRange: distance <= allowed, name: loc.nombre }
        }
      }

      if (!cancelled) {
        setFacialModal((prev) => ({ ...prev, capturing: streamResult.status !== 'fulfilled', checkingLocation: false, locationCheck }))
      }
    }

    void startStream()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facialModal.open, facialModal.capturing])

  /** Captura el frame actual del video y muestra preview. */
  const captureFacialFrame = () => {
    if (!videoRef.current) return
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    const base64  = dataUrl.split(',')[1] ?? ''
    stopFacialStream()
    setFacialModal((prev) => ({ ...prev, previewUrl: dataUrl, photoData: base64 ? { base64, mimeType: 'image/jpeg' } : null }))
  }

  /** Confirma la foto y procede con WebAuthn. */
  const confirmFacialAndVerify = () => {
    const { turn, action, photoData } = facialModal
    setFacialModal({ open: false, turn: null, action: null, previewUrl: null, photoData: null, capturing: false, locationCheck: null, checkingLocation: false })
    if (turn && action) void handleAttendanceVerification(turn, action, photoData)
  }

  const cancelFacialCapture = () => {
    stopFacialStream()
    setFacialModal({ open: false, turn: null, action: null, previewUrl: null, photoData: null, capturing: false, locationCheck: null, checkingLocation: false })
  }

  // Limpia el stream si el componente se desmonta con el modal abierto
  useEffect(() => () => stopFacialStream(), [])

  const handleAttendanceVerification = async (
    turn: TurnAssignment,
    action: 'entrada' | 'salida',
    photoData: { base64: string; mimeType: string } | null,
  ) => {
    const token = getCurrentToken()
    if (!token) return

    setAttendanceLoadingId(turn.id)
    setBiometricFeedback({ kind: 'idle' })

    try {
      const coordinates = await getCurrentCoordinates()

      // SALIDA: siempre simple, sin biometría ni foto
      if (action === 'salida') {
        const result = await apiRequest<VerifyAttendanceResponse>('/attendance/mark', {
          method: 'POST', token,
          body: { turnId: turn.id, action, latitude: coordinates.latitude, longitude: coordinates.longitude },
        })
        const detail = result.attendance
        setBiometricFeedback({
          kind: 'success',
          message: detail
            ? `Salida registrada en ${detail.locationCheck.locationNombre ?? 'el punto operativo'} a las ${new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(detail.markedAt))}.`
            : 'Salida registrada correctamente.',
        })
        await loadTurns()
        await loadBiometricStatus()
        return
      }

      // ENTRADA: requiere foto + biometría (o solo ubicación si no hay biometría)
      if (!biometricStatus.biometricConfigured) {
        const result = await apiRequest<VerifyAttendanceResponse>('/attendance/mark', {
          method: 'POST', token,
          body: {
            turnId:        turn.id,
            action,
            latitude:      coordinates.latitude,
            longitude:     coordinates.longitude,
            photoBase64:   photoData?.base64   ?? undefined,
            photoMimeType: photoData?.mimeType ?? undefined,
          },
        })
        const detail = result.attendance
        setBiometricFeedback({
          kind: 'success',
          message: detail
            ? `Asistencia de ${result.action} registrada en ${detail.locationCheck.locationNombre ?? 'el punto operativo'} a ${Math.round(detail.locationCheck.distanceMeters)} m.`
            : `Asistencia de ${result.action} registrada correctamente.`,
        })
        await loadTurns()
        await loadBiometricStatus()
        return
      }

      // Flujo WebAuthn — usuario con biometría registrada
      const options = await apiRequest<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
        '/attendance/generate-authentication-options',
        { method: 'POST', token, body: { turnId: turn.id, action } },
      )
      const responseJSON = await startAuthentication({ optionsJSON: options })
      const result = await apiRequest<VerifyAttendanceResponse>('/attendance/verify-authentication', {
        method: 'POST', token,
        body: {
          responseJSON,
          latitude:      coordinates.latitude,
          longitude:     coordinates.longitude,
          photoBase64:   photoData?.base64   ?? undefined,
          photoMimeType: photoData?.mimeType ?? undefined,
        },
      })
      const detail = result.attendance
      setBiometricFeedback({
        kind: 'success',
        message: detail
          ? `Asistencia de ${result.action} registrada en ${detail.locationCheck.locationNombre ?? 'el punto operativo'} a ${Math.round(detail.locationCheck.distanceMeters)} m.`
          : `Asistencia de ${result.action} registrada correctamente.`,
      })
      await loadTurns()
      await loadBiometricStatus()
    } catch (err) {
      const isCancelled = err instanceof Error && (err.name === 'NotAllowedError' || err.message.toLowerCase().includes('not allowed'))
      setBiometricFeedback({
        kind: 'error',
        message: isCancelled
          ? 'Verificacion cancelada. Intenta de nuevo cuando estes listo.'
          : (err instanceof Error ? err.message : 'No fue posible verificar la asistencia.'),
      })
    } finally {
      setAttendanceLoadingId(null)
    }
  }

  return (
    <div className="dashboard-page">
      <section className="page-header">
        <div>
          <h1>{canManageTurns ? 'Asignacion de turnos' : 'Mis turnos'}</h1>
          <p className="page-subtitle">
            {isAdmin ? 'Programa y administra los turnos de los empleados de tu empresa.'
              : isSupervisor ? `Turnos de tu punto operativo · ${operationTurns.length} asignados`
              : 'Consulta tus turnos, marca asistencia y revisa tus horas.'}
          </p>
        </div>
        {isAdmin ? (
          <Button icon="icon-plus" className="btn-primary" onClick={() => setShowCreateModal(true)}>
            Nueva asignacion
          </Button>
        ) : null}
      </section>

      {/* Stats — solo admin y supervisor ven todos los turnos de la empresa */}
      {canManageTurns ? (
      <section className="stats-grid">
        {summaryCards.map((item) => (
          <article className="stat-card" key={item.label}>
            <div className={`stat-icon stat-icon--${item.accent}`}><Icon name="icon-bar-chart" size={18} /></div>
            <div className="stat-content">
              <div className="stat-value">{item.value}</div>
              <div className="stat-label">{item.label}</div>
              <div className="stat-meta">
                {item.label === 'Programados' ? `${filteredTurns.length} visibles`
                  : item.label === 'En curso' ? 'Seguimiento activo'
                  : item.label === 'Completados' ? 'Jornadas cerradas'
                  : 'Por validar'}
              </div>
            </div>
          </article>
        ))}
      </section>
      ) : null}

      {/* ── Vista personal (operativo y supervisor): biometría + mis turnos ── */}
      {!isAdmin ? (
        <section className="dashboard-grid">
          {/* Panel biometría */}
          <article className="content-panel">
            <header className="content-panel__header">
              <h2>Verificacion biometrica</h2>
              <span className="turn-table__count">
                {biometricStatus.biometricConfigured ? `${biometricStatus.credentialCount} credencial` : 'Sin credencial'}
              </span>
            </header>
            <div className="biometric-panel">
              <article className="biometric-panel__status">
                <strong>{biometricStatus.biometricConfigured ? 'Biometria activa en este dispositivo' : 'Registra rostro o huella para marcar asistencia'}</strong>
                <span>El sistema validara tu biometria y tu ubicacion contra el punto operativo del turno.</span>
              </article>
              <Button type="button" icon="icon-fingerprint" onClick={() => void handleRegisterBiometric()} disabled={isBiometricBusy}>
                {isBiometricBusy ? 'Registrando biometria...' : biometricStatus.biometricConfigured ? 'Actualizar biometria' : 'Registrar biometria'}
              </Button>
              {biometricFeedback.message ? (
                <p className={biometricFeedback.kind === 'error' ? 'turn-table__error' : 'turn-table__success'}>
                  {biometricFeedback.message}
                </p>
              ) : null}
            </div>
          </article>

          {/* Mis turnos */}
          <article className="content-panel">
            <header className="content-panel__header">
              <h2>Mis turnos y asistencia</h2>
              <span className="turn-table__count">{myTurns.length} asignados</span>
            </header>
            <div className="biometric-turn-list">
              {myTurns.length ? myTurns.map((turn) => {
                const pendingAction = nextAttendanceAction(turn)
                return (
                  <article className={`biometric-turn-item${needsSupervisorConfirm(turn) ? ' biometric-turn-item--needs-confirm' : ''}`} key={turn.id}>
                    <div className="biometric-turn-item__meta">
                      <strong>{turn.titulo}</strong>
                      <span>
                        {new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
                          .format(new Date(turn.fecha + 'T12:00:00'))} · {turn.horario}
                      </span>
                      <span>
                        {turn.locationUrl
                          ? <a href={turn.locationUrl} target="_blank" rel="noopener noreferrer" className="location-link"><Icon name="icon-map-pin" size={12} />{turn.ubicacion}</a>
                          : turn.ubicacion}
                      </span>
                      {needsSupervisorConfirm(turn) && (
                        <span className="needs-confirm-badge">
                          <Icon name="icon-alert-triangle" size={12} /> Pendiente confirmación supervisor · Las horas no cuentan hasta que el supervisor confirme
                        </span>
                      )}
                    </div>
                    <div className="biometric-turn-item__actions">
                      <span className={`turn-status turn-status--${turn.estado}`}>{turn.estado.replace('_', ' ')}</span>

                      {/* Ventana de confirmación — solo cuando está dentro de las 4h previas */}
                      {(turn.estado === 'pendiente' || turn.estado === 'asignado') ? (
                        <>
                          {turn.confirmedDeadline && (
                            <span className={`confirm-window ${isWithinConfirmWindow(turn.confirmedDeadline) ? 'confirm-window--open' : 'confirm-window--expired'}`}>
                              {isWithinConfirmWindow(turn.confirmedDeadline)
                                ? `Confirmar en ${fmtCountdown(minutesUntilDeadline(turn.confirmedDeadline))}`
                                : `Ventana cerrada · ${fmtCountdown(minutesUntilDeadline(turn.confirmedDeadline))}`}
                            </span>
                          )}
                          {isWithinConfirmWindow(turn.confirmedDeadline) ? (
                            <div className="biometric-turn-item__confirm">
                              <Button type="button" size="sm" variant="ghost" disabled={statusLoadingId === turn.id}
                                onClick={() => void handleStatusChange(turn.id, 'confirmado')}>
                                <Icon name="icon-check-circle" size={13} /> Confirmar
                              </Button>
                              <Button type="button" size="sm" variant="ghost" disabled={statusLoadingId === turn.id}
                                onClick={() => void handleStatusChange(turn.id, 'rechazado')}>
                                <Icon name="icon-x-circle" size={13} /> Rechazar
                              </Button>
                            </div>
                          ) : (
                            <p className="confirm-window__msg">El tiempo para confirmar este turno ha vencido. Contacta al administrador.</p>
                          )}
                        </>
                      ) : null}

                      {/* Marcar asistencia propia */}
                      {(turn.estado === 'confirmado' || turn.estado === 'en_proceso') && pendingAction ? (
                        <Button
                          type="button" size="sm"
                          onClick={() => {
                            if (pendingAction === 'salida') {
                              // Salida: sin modal de cámara, directo
                              void handleAttendanceVerification(turn, 'salida', null)
                            } else {
                              openFacialCapture(turn, pendingAction)
                            }
                          }}
                          disabled={attendanceLoadingId === turn.id}
                        >
                          {attendanceLoadingId === turn.id ? 'Registrando...' : pendingAction === 'entrada' ? 'Marcar entrada' : 'Marcar salida'}
                        </Button>
                      ) : turn.estado === 'finalizado' || (turn.attendance?.checkIn && turn.attendance.checkOut) ? (
                        <span className="biometric-turn-item__done">Asistencia completa</span>
                      ) : null}

                      {/* Supervisor: botón Ver operación siempre visible */}
                      {isSupervisor ? (
                        <Button
                          type="button" size="sm" variant="ghost"
                          className="btn-view-operation"
                          onClick={() => setDetailModal({ open: true, turn })}
                        >
                          <Icon name="icon-users" size={13} /> Ver empleados
                        </Button>
                      ) : null}
                    </div>
                  </article>
                )
              }) : (
                <article className="activity-item activity-item--empty">
                  <div className="activity-item__body">
                    <strong>Sin turnos asignados</strong>
                    <span>Cuando tengas un turno operativo disponible podras marcar asistencia aqui.</span>
                  </div>
                </article>
              )}
            </div>
          </article>
        </section>
      ) : null}

      {/* Panel supervisor — confirmación de llegada: solo su operación */}
      {isSupervisor ? (
        <section className="content-panel supervisor-panel">
          <header className="content-panel__header">
            <div>
              <h2>Confirmacion de llegada</h2>
              <p style={{ fontSize: 13, color: 'var(--clr-text-2)', margin: '2px 0 0' }}>
                Empleados de tu punto operativo · {operationTurns.length} turno{operationTurns.length !== 1 ? 's' : ''}
              </p>
            </div>
            <span className="supervisor-badge">
              <Icon name="icon-shield" size={13} /> Supervisor
            </span>
          </header>
          <div className="biometric-turn-list">
            {operationTurns.filter((t) => t.estado === 'en_proceso' || t.estado === 'pendiente' || t.estado === 'asignado' || t.estado === 'confirmado').length
              ? operationTurns
                  .filter((t) => t.estado !== 'rechazado')
                  .map((turn) => (
                    <article className={`biometric-turn-item${needsSupervisorConfirm(turn) ? ' biometric-turn-item--needs-confirm' : ''}`} key={turn.id}>
                      <div className="biometric-turn-item__meta">
                        <strong>{turn.asignadoA}</strong>
                        <span>
                          {turn.titulo} · {new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
                            .format(new Date(turn.fecha + 'T12:00:00'))} · {turn.horario}
                        </span>
                        <span>
                          {turn.locationUrl
                            ? <a href={turn.locationUrl} target="_blank" rel="noopener noreferrer" className="location-link"><Icon name="icon-map-pin" size={12} />{turn.ubicacion}</a>
                            : turn.ubicacion}
                        </span>
                        {needsSupervisorConfirm(turn) && (
                          <span className="needs-confirm-badge">
                            <Icon name="icon-alert-triangle" size={12} /> Ya ingresó · Confirma su llegada para que las horas cuenten
                          </span>
                        )}
                      </div>
                      <div className="biometric-turn-item__actions">
                        <span className={`turn-status turn-status--${turn.estado}`}>{turn.estado.replace('_', ' ')}</span>
                        {turn.estado !== 'confirmado' && turn.estado !== 'finalizado' ? (
                          <div className="biometric-turn-item__confirm">
                            <Button
                              type="button" size="sm" variant="ghost"
                              disabled={statusLoadingId === turn.id}
                              onClick={() => void handleStatusChange(turn.id, 'confirmado')}
                            >
                              <Icon name="icon-check-circle" size={13} /> Confirmar llegada
                            </Button>
                            <Button
                              type="button" size="sm" variant="ghost"
                              disabled={statusLoadingId === turn.id}
                              onClick={() => void handleStatusChange(turn.id, 'rechazado')}
                            >
                              <Icon name="icon-x-circle" size={13} /> Rechazar
                            </Button>
                          </div>
                        ) : (
                          <span className="biometric-turn-item__done">
                            {turn.estado === 'confirmado' ? '✓ Confirmado' : 'Completado'}
                          </span>
                        )}
                      </div>
                    </article>
                  ))
              : (
                <article className="activity-item activity-item--empty">
                  <div className="activity-item__body">
                    <strong>Sin turnos activos</strong>
                    <span>No hay empleados con turnos en curso para confirmar.</span>
                  </div>
                </article>
              )}
          </div>
          {biometricFeedback.message ? (
            <p className={biometricFeedback.kind === 'error' ? 'turn-table__error' : 'turn-table__success'} style={{ marginTop: '0.75rem' }}>
              {biometricFeedback.message}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Modal de detalles del turno — supervisor confirma llegada de compañeros */}
      <Modal
        open={detailModal.open}
        title={detailModal.turn
          ? `${detailModal.turn.titulo} · ${new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(detailModal.turn.fecha + 'T12:00:00'))}`
          : 'Detalles del turno'}
        description={detailModal.turn
          ? `${detailModal.turn.horario} · ${detailModal.turn.ubicacion}`
          : ''}
        onClose={() => setDetailModal({ open: false, turn: null })}
      >
        {detailModal.turn ? (() => {
          const turnLocationId = detailModal.turn.locationId
          const turnFecha      = detailModal.turn.fecha
          const turnTitulo     = detailModal.turn.titulo

          // TODOS los empleados asignados al mismo turno (mismo titulo + fecha + punto)
          // incluyendo al supervisor para mostrar el equipo completo
          const allAssigned = turns.filter((t) => {
            if (t.fecha !== turnFecha) return false
            if (turnLocationId) return t.locationId === turnLocationId && t.titulo === turnTitulo
            return t.titulo === turnTitulo
          })

          // Separar para el resumen
          const checkedIn    = allAssigned.filter((t) => Boolean(t.attendance?.checkIn))
          const notCheckedIn = allAssigned.filter((t) => !t.attendance?.checkIn)

          return (
            <div className="turn-detail-modal">
              {/* Resumen rápido */}
              <div className="turn-detail-modal__summary">
                <span className="detail-chip"><strong>{allAssigned.length}</strong> empleados</span>
                <span className="detail-chip"><strong>{checkedIn.length}</strong> ingresaron</span>
                <span className="detail-chip"><strong>{notCheckedIn.length}</strong> pendientes</span>
              </div>

              {allAssigned.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--clr-text-3)', textAlign: 'center', padding: '.5rem 0' }}>
                  No hay empleados asignados a este turno.
                </p>
              ) : (
                <div className="turn-detail-modal__list">
                  {allAssigned.map((t) => {
                    const isSelf        = t.assignedToUserId === currentUserId
                    const hasCheckedIn  = Boolean(t.attendance?.checkIn)
                    const hasCheckedOut = Boolean(t.attendance?.checkOut)
                    const checkInTime   = t.attendance?.checkIn?.markedAt
                      ? new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(t.attendance.checkIn.markedAt))
                      : null

                    return (
                      <article key={t.id} className={`colleague-card${needsSupervisorConfirm(t) ? ' colleague-card--needs-confirm' : ''}`}>
                        <div className="colleague-card__avatar">
                          {t.asignadoA.split(' ').slice(0,2).map((p) => p[0] ?? '').join('').toUpperCase()}
                        </div>
                        <div className="colleague-card__info">
                          <strong>{t.asignadoA}{isSelf ? ' (tú)' : ''}</strong>
                          <span>{t.titulo} · {t.horario}</span>
                          {checkInTime && (
                            <span className="colleague-card__time">
                              <Icon name="icon-check-circle" size={12} /> Ingresó a las {checkInTime}
                              {hasCheckedOut && <span> · Ya salió</span>}
                            </span>
                          )}
                        </div>
                        <div className="colleague-card__actions">
                          <span className={`turn-status turn-status--${t.estado}`}>{t.estado.replace('_', ' ')}</span>
                          {/* Supervisor aprueba a los compañeros que ya marcaron entrada */}
                          {!isSelf && hasCheckedIn && t.estado !== 'confirmado' && t.estado !== 'finalizado' ? (
                            <Button
                              type="button" size="sm" variant="primary"
                              disabled={statusLoadingId === t.id}
                              onClick={() => void handleStatusChange(t.id, 'confirmado')}
                            >
                              <Icon name="icon-check-circle" size={13} /> Aprobar ingreso
                            </Button>
                          ) : t.estado === 'confirmado' || (isSelf && hasCheckedIn) ? (
                            <span className="colleague-card__done">✓ {isSelf ? 'Tu ingreso' : 'Aprobado'}</span>
                          ) : !hasCheckedIn ? (
                            <span className="colleague-card__pending">Esperando ingreso</span>
                          ) : null}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}

              {biometricFeedback.message ? (
                <p className={biometricFeedback.kind === 'error' ? 'turn-table__error' : 'turn-table__success'}>
                  {biometricFeedback.message}
                </p>
              ) : null}
            </div>
          )
        })() : null}
      </Modal>

      {/* Modal de reasignación — admin */}
      <Modal
        open={reassignModal.open}
        title="Reasignar turno"
        description={reassignModal.turn ? `Reasignar "${reassignModal.turn.titulo}" del ${reassignModal.turn.fecha} · ${reassignModal.turn.horario}` : ''}
        onClose={() => setReassignModal((p) => ({ ...p, open: false }))}
      >
        <div className="reassign-modal">
          {reassignModal.loading ? (
            <div className="reassign-modal__loading"><Icon name="icon-refresh" size={20} /><span>Cargando empleados disponibles...</span></div>
          ) : reassignModal.available.length === 0 ? (
            <p className="reassign-modal__empty">No hay empleados disponibles sin turno ese día.</p>
          ) : (
            <div className="reassign-modal__list">
              {reassignModal.available.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`worker-chip${reassignModal.selectedWorkerId === w.id ? ' worker-chip--on' : ''}`}
                  onClick={() => setReassignModal((p) => ({ ...p, selectedWorkerId: w.id }))}
                >
                  <span className="worker-chip__avatar">{w.nombreCompleto.split(' ').slice(0,2).map((p) => p[0] ?? '').join('').toUpperCase()}</span>
                  <span className="worker-chip__meta">
                    <strong>{w.nombreCompleto}</strong>
                    <small>{w.cargo}</small>
                  </span>
                  {reassignModal.selectedWorkerId === w.id && <span className="worker-chip__check"><Icon name="icon-check" size={13} /></span>}
                </button>
              ))}
            </div>
          )}
          {reassignModal.feedback && (
            <p className="turn-table__error">{reassignModal.feedback}</p>
          )}
          <div className="confirm-actions">
            <Button type="button" variant="ghost" onClick={() => setReassignModal((p) => ({ ...p, open: false }))}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!reassignModal.selectedWorkerId || reassignModal.loading}
              onClick={() => void handleReassign()}
            >
              <Icon name="icon-user" size={15} /> Reasignar turno
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal de captura facial */}
      <Modal
        open={facialModal.open}
        title={facialModal.action === 'entrada' ? 'Foto de entrada' : 'Foto de salida'}
        description="Mira a la camara y toma una foto para registrar tu asistencia."
        onClose={cancelFacialCapture}
      >
        <div className="facial-modal">
          {facialModal.locationCheck && (
            <div className={`location-check-banner location-check-banner--${facialModal.locationCheck.withinRange ? 'ok' : 'out'}`}>
              <Icon name={facialModal.locationCheck.withinRange ? 'icon-map-pin' : 'icon-alert-triangle'} size={14} />
              <span>
                {facialModal.locationCheck.withinRange
                  ? `Dentro del radio · ${facialModal.locationCheck.distance} m de ${facialModal.locationCheck.name}`
                  : `Fuera del radio · ${facialModal.locationCheck.distance} m (máx. ${facialModal.locationCheck.allowed} m) de ${facialModal.locationCheck.name}`}
              </span>
            </div>
          )}
          {facialModal.checkingLocation && !facialModal.locationCheck && (
            <div className="location-check-banner location-check-banner--checking">
              <Icon name="icon-map-pin" size={14} /><span>Verificando ubicación...</span>
            </div>
          )}
          {facialModal.previewUrl ? (
            <>
              <img src={facialModal.previewUrl} alt="Vista previa de la foto" className="facial-modal__preview" />
              <div className="facial-modal__actions">
                <Button type="button" variant="ghost"
                  onClick={() => setFacialModal((p) => ({ ...p, previewUrl: null, photoData: null }))}>
                  Repetir
                </Button>
                <Button type="button" onClick={confirmFacialAndVerify}>
                  Confirmar y verificar
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* El <video> siempre está montado para que videoRef sea válido al asignar el stream */}
              <div className="facial-modal__video-wrap">
                {facialModal.capturing && (
                  <div className="facial-modal__loading-overlay">
                    <Icon name="icon-refresh" size={24} /><span>Iniciando camara...</span>
                  </div>
                )}
                <video ref={videoRef} className="facial-modal__video" autoPlay playsInline muted />
              </div>
              <div className="facial-modal__actions">
                <Button type="button" variant="ghost" onClick={cancelFacialCapture}>Cancelar</Button>
                <Button type="button" icon="icon-check-circle" onClick={captureFacialFrame} disabled={facialModal.capturing}>
                  Tomar foto
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ── Panel de horas trabajadas ────────────────────────────── */}
      <section className="hours-panel">
        <header className="hours-panel__header">
          <div>
            <h2>Horas trabajadas</h2>
            <p>{canManageTurns ? 'Resumen mensual y diario por empleado.' : 'Tu resumen de horas por mes y por día.'}</p>
          </div>
          {/* Selector de mes */}
          <div className="hours-panel__month-select">
            <Icon name="icon-calendar" size={15} />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              aria-label="Seleccionar mes"
            >
              {monthlyHours.length
                ? monthlyHours.map((m) => (
                    <option key={m.mes} value={m.mes}>{fmtMes(m.mes)}</option>
                  ))
                : <option value={selectedMonth}>{fmtMes(selectedMonth)}</option>
              }
            </select>
          </div>
        </header>

        {/* Resumen mensual — chips con cada mes */}
        {monthlyHours.length > 0 ? (
          <div className="hours-month-strip">
            {monthlyHours.map((m) => (
              <button
                key={m.mes}
                type="button"
                className={`hours-month-chip${m.mes === selectedMonth ? ' hours-month-chip--active' : ''}`}
                onClick={() => setSelectedMonth(m.mes)}
              >
                <strong>{fmtHours(m.hours)}</strong>
                <span>{fmtMes(m.mes)}</span>
                <small>{m.count} turno{m.count !== 1 ? 's' : ''}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="hours-panel__empty">Sin turnos registrados.</p>
        )}

        {/* Tabla por empleado — solo admin/supervisor */}
        {canManageTurns && employeeMonthlyHours.length > 0 ? (
          <div className="hours-employee-table">
            <div className="hours-employee-table__title">
              Detalle por empleado · {fmtMes(selectedMonth)}
              <span className="hours-total-badge">{fmtHours(totalThisMonth)} total</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Turnos</th>
                    <th>Días trabajados</th>
                    <th>Horas totales</th>
                    <th>Prom. diario</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeMonthlyHours.map((emp) => (
                    <tr key={emp.nombre}>
                      <td>
                        <div className="person-cell">
                          <div className="person-cell__avatar">
                            {emp.nombre.split(' ').slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase()}
                          </div>
                          <strong>{emp.nombre}</strong>
                        </div>
                      </td>
                      <td>{emp.turns}</td>
                      <td>{emp.days}</td>
                      <td><span className="hours-badge">{fmtHours(emp.hours)}</span></td>
                      <td>{emp.days > 0 ? fmtHours(emp.hours / emp.days) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* Tabla diaria — todos los roles */}
        {dailyHours.length > 0 ? (
          <div className="hours-daily-table">
            <div className="hours-daily-table__title">
              Detalle diario · {fmtMes(selectedMonth)}
              {!canManageTurns && <span className="hours-total-badge">{fmtHours(totalThisMonth)} este mes</span>}
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Turnos</th>
                    <th>Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyHours.map((d) => (
                    <tr key={d.fecha}>
                      <td>{new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d.fecha + 'T12:00:00'))}</td>
                      <td>{d.count}</td>
                      <td><span className="hours-badge">{fmtHours(d.hours)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          dailyHours.length === 0 && monthlyHours.length > 0 ? (
            <p className="hours-panel__empty">Sin turnos en {fmtMes(selectedMonth)}.</p>
          ) : null
        )}
      </section>

      {/* Filtros y tabla general — solo admin y supervisor */}
      {canManageTurns ? (
      <>
      <section className="filters-card">
        <div className="filters-title">Filtros</div>
        <div className="filters-row">
          <label className="filter-group filter-search">
            <span className="filter-label">Buscar</span>
            <Icon name="icon-search" size={16} />
            <input className="filter-input" type="search" placeholder="Buscar empleado o responsable"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="filter-group">
            <span className="filter-label">Fecha</span>
            <input className="filter-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </label>
          <label className="filter-group">
            <span className="filter-label">Estado</span>
            <select className="filter-select" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="asignado">Asignado</option>
              <option value="en_proceso">En curso</option>
              <option value="confirmado">Confirmado</option>
              <option value="rechazado">Rechazado</option>
              <option value="finalizado">Finalizado</option>
            </select>
          </label>
          <label className="filter-group">
            <span className="filter-label">Responsable</span>
            <select className="filter-select" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
              <option value="">Todos</option>
              {responsibleOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </label>
          <Button type="button" variant="ghost" className="btn-clear" onClick={handleResetFilters}>Limpiar</Button>
        </div>
      </section>

      <section className="content-card">
        <div className="table-header">
          <div className="table-title">Turnos programados</div>
          <div className="table-count">{filteredTurns.length} resultados</div>
        </div>
        {error ? <p className="turn-table__error">{error}</p> : null}
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Empleado</th><th>Turno</th><th>Horario</th>
                <th>Fecha</th><th>Ubicacion</th><th>Estado</th>
                {canManageTurns ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredTurns.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="table-person">
                      <span className="table-person__avatar">
                        {row.asignadoA.split(' ').slice(0,2).map((p) => p[0] ?? '').join('').toUpperCase()}
                      </span>
                      <div className="table-person__meta">
                        <strong>{row.asignadoA}</strong>
                        <span>{row.descripcion}</span>
                      </div>
                    </div>
                  </td>
                  <td><span className="assignment-shift">{row.titulo}</span></td>
                  <td>{row.horario}</td>
                  <td>{row.fecha}</td>
                  <td>
                    {row.locationUrl ? (
                      <a href={row.locationUrl} target="_blank" rel="noopener noreferrer" className="location-link">
                        <Icon name="icon-map-pin" size={13} />
                        {row.ubicacion}
                      </a>
                    ) : (
                      row.ubicacion
                    )}
                  </td>
                  <td>
                    <span className={`turn-status turn-status--${row.estado}`}>
                      {row.estado.replace('_', ' ')}
                    </span>
                  </td>
                  {canManageTurns ? (
                    <td>
                      {row.estado !== 'confirmado' && row.estado !== 'rechazado' && row.estado !== 'finalizado' ? (
                        <div className="table-actions">
                          <Button
                            type="button" size="sm" variant="ghost"
                            disabled={statusLoadingId === row.id}
                            onClick={() => void handleStatusChange(row.id, 'confirmado')}
                          >
                            <Icon name="icon-check-circle" size={14} /> Confirmar
                          </Button>
                          <Button
                            type="button" size="sm" variant="ghost"
                            disabled={statusLoadingId === row.id}
                            onClick={() => void handleStatusChange(row.id, 'rechazado')}
                          >
                            <Icon name="icon-x-circle" size={14} /> Rechazar
                          </Button>
                          {/* Botón reasignar si venció la ventana de confirmación */}
                          {isAdmin && row.confirmedDeadline && !isWithinConfirmWindow(row.confirmedDeadline) && (
                            <Button
                              type="button" size="sm" variant="ghost"
                              onClick={() => void openReassignModal(row)}
                            >
                              <Icon name="icon-user" size={14} /> Reasignar
                            </Button>
                          )}
                        </div>
                      ) : row.estado === 'rechazado' && isAdmin ? (
                        <Button type="button" size="sm" variant="ghost" onClick={() => void openReassignModal(row)}>
                          <Icon name="icon-user" size={14} /> Reasignar
                        </Button>
                      ) : (
                        <span className="table-actions__done">—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </> ) : null}
      <Modal
        open={showCreateModal}
        title="Nueva asignacion"
        description="Crea una nueva asignacion operativa para un empleado."
        onClose={() => { setShowCreateModal(false); setCreateForm({ assignedToUserIds: [], titulo: 'Manana', fecha: '', hora: '06:00', horaFin: '14:00', locationId: '', descripcion: '' }) }}
      >
        <div className="assignment-modal">
          <label className="filter-toolbar__field">
            <span>Empleados ({createForm.assignedToUserIds.length} seleccionados)</span>
            <div className="worker-checklist">
              {workers.length ? workers.map((w) => (
                <label key={w.id} className="worker-checklist__item">
                  <input
                    type="checkbox"
                    checked={createForm.assignedToUserIds.includes(w.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...createForm.assignedToUserIds, w.id]
                        : createForm.assignedToUserIds.filter((id) => id !== w.id)
                      setCreateForm((c) => ({ ...c, assignedToUserIds: next }))
                    }}
                  />
                  <span>{w.nombreCompleto}</span>
                  <span className="worker-checklist__cargo">{w.cargo}</span>
                </label>
              )) : <span className="worker-checklist__empty">Sin empleados registrados.</span>}
            </div>
          </label>
          <label className="filter-toolbar__field">
            <span>Turno</span>
            <select value={createForm.titulo}
              onChange={(e) => setCreateForm((c) => ({ ...c, titulo: e.target.value }))}>
              <option value="Manana">Manana</option>
              <option value="Tarde">Tarde</option>
              <option value="Noche">Noche</option>
            </select>
          </label>
          <label className="filter-toolbar__field">
            <span>Fecha</span>
            <input type="date" value={createForm.fecha}
              onChange={(e) => setCreateForm((c) => ({ ...c, fecha: e.target.value }))} />
          </label>
          <label className="filter-toolbar__field">
            <span>Ubicacion</span>
            <select value={createForm.locationId}
              onChange={(e) => setCreateForm((c) => ({ ...c, locationId: e.target.value }))}>
              <option value="">Selecciona una ubicacion</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.nombre}</option>
              ))}
            </select>
          </label>
          <label className="filter-toolbar__field">
            <span>Hora inicio</span>
            <input type="time" value={createForm.hora}
              onChange={(e) => setCreateForm((c) => ({ ...c, hora: e.target.value }))} />
          </label>
          <label className="filter-toolbar__field">
            <span>Hora fin</span>
            <input type="time" value={createForm.horaFin}
              onChange={(e) => setCreateForm((c) => ({ ...c, horaFin: e.target.value }))} />
          </label>
          <label className="filter-toolbar__field filter-toolbar__field--full">
            <span>Detalle</span>
            <textarea rows={3} value={createForm.descripcion}
              onChange={(e) => setCreateForm((c) => ({ ...c, descripcion: e.target.value }))} />
          </label>
          <div className="assignment-modal__actions">
            <Button type="button" variant="ghost" onClick={() => setShowCreateModal(false)}>Cancelar</Button>
            <Button type="button" onClick={() => void handleCreateAssignment()}>Guardar asignacion</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
