import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, CustomForm, Icon, Modal, type CustomFormField, type CustomFormValues } from '../components'
import {
  apiRequest,
  type CompanyManagementResponse,
  type LocationResponse,
  type PositionResponse,
  type TurnResponse,
  type UserInvitationResponse,
  type UserResponse,
} from '../lib/api'
import { type AccessModule } from '../lib/access'
import { getCurrentToken, getCurrentUser, setCurrentUser } from '../lib/auth-storage'

type FeedbackState = { kind: 'idle' | 'success' | 'error'; message?: string }
type ActiveModal = 'employee' | 'position' | 'location' | 'location-edit' | 'location-delete' | 'turn' | 'turn-delete' | null

const accessModuleLabels: Record<AccessModule, string> = {
  dashboard: 'Inicio',
  'turnos-fijos': 'Turnos fijos',
  'turnos-rotativos': 'Turnos rotativos',
  'horas-extras-recargos': 'Horas extras y recargos',
  geolocalizacion: 'Geolocalización',
  'permisos-ausencias': 'Permisos y ausencias',
  'biometria-facial': 'Biometría / facial',
  teletrabajo: 'Teletrabajo',
  facturacion: 'Facturación',
  informes: 'Informes',
  configuracion: 'Configuración',
  'asistencia-clase': 'Asistencia por clase',
  'codigo-qr': 'Código QR',
  'asistencia-docente': 'Asistencia docente',
  'porcentaje-asistencia': '% mínimo asistencia',
  justificaciones: 'Justificaciones',
  'alertas-inasistencia': 'Alertas inasistencia',
  'eventos-talleres': 'Eventos y talleres',
}

const accessModuleDescriptions: Record<AccessModule, string> = {
  dashboard: 'Vista principal con resumen.',
  'turnos-fijos': 'Control de entradas y salidas en horarios rígidos.',
  'turnos-rotativos': 'Asignación dinámica de turnos por semana/mes.',
  'horas-extras-recargos': 'Cálculo de recargos nocturnos, dominicales y festivos.',
  geolocalizacion: 'Validación GPS contra puntos de operación.',
  'permisos-ausencias': 'Gestión de licencias, vacaciones e incapacidades.',
  'biometria-facial': 'Registro seguro con WebAuthn o foto facial.',
  teletrabajo: 'Fichaje virtual desde cualquier ubicación.',
  facturacion: 'Generación de cuentas de cobro por horas.',
  informes: 'Consultar y exportar reportes.',
  configuracion: 'Administrar cargos, ubicaciones y usuarios.',
  'asistencia-clase': 'Pase de lista por asignatura.',
  'codigo-qr': 'Código QR dinámico para confirmar presencia.',
  'asistencia-docente': 'Verificación de horas cátedra.',
  'porcentaje-asistencia': 'Control de faltas para aprobación.',
  justificaciones: 'Excusas médicas o institucionales.',
  'alertas-inasistencia': 'Notificaciones por faltas consecutivas.',
  'eventos-talleres': 'Control de actividades extracurriculares.',
}

const positionAccessOptions = Object.entries(accessModuleLabels).map(([value, label]) => ({
  value: value as AccessModule,
  label,
  description: accessModuleDescriptions[value as AccessModule],
}))

const positionFields: CustomFormField[] = [
  { name: 'nombre', label: 'Nombre del cargo', placeholder: 'Ej. Auxiliar de enfermeria', required: true },
  { name: 'valorHora', label: 'Valor por hora ($)', placeholder: 'Ej. 15000', type: 'text' },
  { name: 'descripcion', label: 'Descripcion', type: 'textarea', placeholder: 'Funciones del cargo', fullWidth: true },
]

const locationFields: CustomFormField[] = [
  { name: 'nombre', label: 'Punto de operacion', placeholder: 'Ej. Sede Norte', required: true },
  { name: 'direccion', label: 'Direccion', placeholder: 'Direccion del punto', required: true },
  { name: 'googleMapsUrl', label: 'URL Google Maps', placeholder: 'Pega la URL con coordenadas', required: true, fullWidth: true },
  { name: 'radioTolerancia', label: 'Radio tolerancia (m)', placeholder: 'Ej. 50' },
  { name: 'descripcion', label: 'Descripcion', type: 'textarea', placeholder: 'Detalle del punto', fullWidth: true },
]

const invitationBaseFields: CustomFormField[] = [
  { name: 'positionId', label: 'Cargo', type: 'select', placeholder: 'Selecciona un cargo', required: true, options: [] },
  { name: 'role', label: 'Rol', type: 'select', required: true, defaultValue: 'operativo',
    options: [
      { label: 'Operativo', value: 'operativo' },
      { label: 'Supervisor', value: 'supervisor' },
      { label: 'Admin', value: 'admin' },
    ],
    helperText: 'El rol queda fijo en el link de invitacion.' },
]

export default function AttendanceAdminPage() {
  const token = getCurrentToken()
  const currentUser = getCurrentUser()
  const [searchParams] = useSearchParams()
  const searchQuery = searchParams.get('q')?.toLowerCase() ?? ''

  const [loading, setLoading] = useState(true)
  const [positions, setPositions] = useState<PositionResponse[]>([])
  const [locations, setLocations] = useState<LocationResponse[]>([])
  const [workers, setWorkers] = useState<UserResponse[]>([])
  const [invitations, setInvitations] = useState<UserInvitationResponse[]>([])
  const [turns, setTurns] = useState<TurnResponse[]>([])
  const [companyName, setCompanyName] = useState('')

  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  const [editingPosition, setEditingPosition] = useState<PositionResponse | null>(null)
  const [positionPermissions, setPositionPermissions] = useState<AccessModule[]>(['dashboard', 'turnos-fijos'])
  const [editingLocation, setEditingLocation] = useState<LocationResponse | null>(null)

  // Multi-employee turn form state
  const [turnForm, setTurnForm] = useState({
    titulo: '', fecha: '', hora: '', horaFin: '', locationId: '', descripcion: '', confirmHoursLimit: '4',
  })
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([])
  const [turnConflicts, setTurnConflicts] = useState<string[]>([])
  const [deletingTurn, setDeletingTurn] = useState<TurnResponse | null>(null)

  const [positionFeedback, setPositionFeedback] = useState<FeedbackState>({ kind: 'idle' })
  const [locationFeedback, setLocationFeedback] = useState<FeedbackState>({ kind: 'idle' })
  const [invitationFeedback, setInvitationFeedback] = useState<FeedbackState>({ kind: 'idle' })
  const [turnFeedback, setTurnFeedback] = useState<FeedbackState>({ kind: 'idle' })

  // Live clock
  const [currentTimeLabel, setCurrentTimeLabel] = useState(() =>
    new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()),
  )
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const timer = setInterval(() => setCurrentTimeLabel(fmt.format(new Date())), 1000)
    return () => clearInterval(timer)
  }, [])

  const loadAdminData = async () => {
    if (!token) return
    try {
      // Admin y supervisor usan /management. Otros roles usan /turns
      const isManagement = currentUser?.role === 'admin' || currentUser?.cargo?.toLowerCase().includes('supervisor')

      if (isManagement) {
        const response = await apiRequest<CompanyManagementResponse>('/companies/management', { token })
        setPositions(response.positions)
        setWorkers(response.users.filter((u) => u.role !== 'admin'))
        setLocations(response.locations)
        setInvitations(response.invitations)
        setTurns(response.turns)
        if (response.company?.nombre) setCompanyName(response.company.nombre)
        if (response.currentUser && currentUser) {
          setCurrentUser({ ...currentUser, companyId: response.currentUser.companyId,
            role: response.currentUser.role, positionId: response.currentUser.positionId,
            allowedModules: response.currentUser.allowedModules })
        }
      } else {
        // Docente/operativo — carga solo turnos y ubicaciones
        const [turnsRes, locsRes] = await Promise.all([
          apiRequest<TurnResponse[]>('/turns', { token }),
          apiRequest<LocationResponse[]>('/locations', { token }).catch(() => [] as LocationResponse[]),
        ])
        setTurns(turnsRes)
        setLocations(locsRes)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) {
      void Promise.resolve().then(() => setLoading(false))
      return
    }
    void loadAdminData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Derived fields with dynamic options
  const invitationFields = useMemo<CustomFormField[]>(() => invitationBaseFields.map((f) =>
    f.name === 'positionId' ? { ...f,
      placeholder: positions.length ? 'Selecciona un cargo' : 'Primero registra un cargo',
      options: positions.map((p) => ({ label: p.nombre, value: p.id })) } : f
  ), [positions])

  const positionFormFields = useMemo<CustomFormField[]>(() => positionFields.map((f) => ({
    ...f,
    defaultValue: f.name === 'nombre' ? editingPosition?.nombre ?? ''
      : f.name === 'descripcion' ? editingPosition?.descripcion ?? ''
      : f.name === 'valorHora' ? editingPosition?.valorHora?.toString() ?? ''
      : f.defaultValue,
  })), [editingPosition])

  // ── Filtros del panel de asistencia ───────────────────────
  const [filterMonth, setFilterMonth]       = useState('')
  const [filterWorkerId, setFilterWorkerId] = useState('')
  const [filterLocationId, setFilterLocationId] = useState('')

  // Meses disponibles en los turnos
  const availableMonths = useMemo(() => {
    const set = new Set(turns.map((t) => t.fecha.slice(0, 7)))
    return [...set].sort().reverse()
  }, [turns])

  // Horas efectivas de un turno — usa checkIn/checkOut reales; maneja turnos nocturnos
  const calcHours = (turn: TurnResponse): number => {
    const ci = turn.attendance?.checkIn?.markedAt
    if (!ci) return 0
    const ciMs = new Date(ci).getTime()

    const co = turn.attendance?.checkOut?.markedAt
    if (co) {
      const diff = new Date(co).getTime() - ciMs
      return diff > 0 ? Math.round((diff / 3_600_000) * 100) / 100 : 0
    }

    // Sin checkOut: auto-salida a horaFin programada (con soporte nocturno)
    if (!turn.horaFin || !turn.hora) return 0
    const [sh, sm] = turn.hora.split(':').map(Number)
    const [eh, em] = turn.horaFin.split(':').map(Number)
    if (Number.isNaN(sh) || Number.isNaN(eh)) return 0

    let scheduledEnd   = new Date(`${turn.fecha}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00`).getTime()
    const scheduledStart = new Date(`${turn.fecha}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00`).getTime()
    // Turno nocturno: fin al día siguiente
    if (scheduledEnd <= scheduledStart) scheduledEnd += 24 * 3_600_000

    const effectiveEnd = Math.min(scheduledEnd, Date.now())
    const diff = effectiveEnd - ciMs
    return diff > 0 ? Math.round((diff / 3_600_000) * 100) / 100 : 0
  }

  const fmtH = (h: number) => {
    const totalMin = Math.round(h * 60)
    const hrs = Math.floor(totalMin / 60)
    const min = totalMin % 60
    return hrs === 0 ? `${min}m` : min === 0 ? `${hrs}h` : `${hrs}h ${min}m`
  }

  // Attendance table rows — one row per turn (not per worker)
  const attendanceRows = useMemo(() => {
    const rows = turns
      .filter((t) => {
        if (filterMonth     && !t.fecha.startsWith(filterMonth))       return false
        if (filterWorkerId  && t.assignedToUserId !== filterWorkerId)   return false
        if (filterLocationId && t.locationId !== filterLocationId)      return false
        return true
      })
      .map((turn) => {
        const worker = workers.find((w) => w.id === turn.assignedToUserId)
        const checkInTime = turn.attendance?.checkIn?.markedAt
          ? new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(turn.attendance.checkIn.markedAt))
          : null
        const checkOutTime = turn.attendance?.checkOut?.markedAt
          ? new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(turn.attendance.checkOut.markedAt))
          : null
        const horas = calcHours(turn)
        return {
          turnId: turn.id,
          turnObj: turn,
          workerId: worker?.id ?? turn.assignedToUserId ?? '',
          nombre: worker?.nombreCompleto ?? turn.assignedToUserName ?? 'Sin asignar',
          cargo: worker?.cargo ?? '',
          locationId: turn.locationId ?? '',
          fecha: turn.fecha,
          turnoTitulo: turn.titulo,
          horarioTurno: `${turn.hora}${turn.horaFin ? ` – ${turn.horaFin}` : ''}`,
          ubicacion: turn.locationNombre ?? '',
          entrada: checkInTime,
          salida: checkOutTime,
          horas,
          estado: turn.estado,
        }
      })

    if (!searchQuery) return rows
    return rows.filter((r) =>
      r.nombre.toLowerCase().includes(searchQuery) ||
      r.cargo.toLowerCase().includes(searchQuery) ||
      r.turnoTitulo.toLowerCase().includes(searchQuery) ||
      r.ubicacion.toLowerCase().includes(searchQuery),
    )
  }, [turns, workers, searchQuery, filterMonth, filterWorkerId, filterLocationId])

  // ── Cuenta de cobro: resumen por empleado ──────────────────
  const billingRows = useMemo(() => {
    const map = new Map<string, {
      workerId: string; nombre: string; cargo: string; documento: string
      turnos: number; horasTotales: number; diasTrabajados: Set<string>
    }>()
    for (const row of attendanceRows) {
      if (row.estado === 'rechazado') continue
      if (!row.entrada) continue  // sin checkIn → no facturar este turno
      const cur = map.get(row.workerId) ?? {
        workerId: row.workerId, nombre: row.nombre, cargo: row.cargo,
        documento: workers.find((w) => w.id === row.workerId)?.numeroDocumento ?? '',
        turnos: 0, horasTotales: 0, diasTrabajados: new Set<string>(),
      }
      cur.turnos++
      cur.horasTotales += row.horas
      cur.diasTrabajados.add(row.fecha)
      map.set(row.workerId, cur)
    }
    return [...map.values()]
      .map((v) => ({ ...v, dias: v.diasTrabajados.size }))
      .sort((a, b) => b.horasTotales - a.horasTotales)
  }, [attendanceRows, workers])

  const totalBillingHours = useMemo(
    () => billingRows.reduce((s, r) => s + r.horasTotales, 0), [billingRows])

  const exportBillingCSV = () => {
    const mes = filterMonth || availableMonths[0] || 'todos'
    const header = 'Empleado,Documento,Cargo,Turnos,Dias,Horas totales\n'
    const rows = billingRows.map((r) =>
      `"${r.nombre}","${r.documento}","${r.cargo}",${r.turnos},${r.dias},${r.horasTotales.toFixed(2)}`
    ).join('\n')
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `cuenta-cobro-${mes}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Turnos agrupados por ubicación + horario ─────────────
  const groupedTurns = useMemo(() => {
    const map = new Map<string, {
      key: string; ubicacion: string; locationId: string; fecha: string
      hora: string; horaFin: string; titulo: string
      mapsUrl: string | null
      empleados: typeof attendanceRows
    }>()

    for (const row of attendanceRows) {
      const key = `${row.locationId}|${row.fecha}|${row.horarioTurno}`
      const loc = locations.find((l) => l.id === row.locationId)
      const mapsUrl = loc?.latitud && loc?.longitud
        ? `https://www.google.com/maps?q=${loc.latitud},${loc.longitud}`
        : null

      const existing = map.get(key) ?? {
        key, ubicacion: row.ubicacion, locationId: row.locationId,
        fecha: row.fecha, hora: row.horarioTurno.split(' – ')[0] ?? '',
        horaFin: row.horarioTurno.split(' – ')[1] ?? '',
        titulo: row.turnoTitulo, mapsUrl, empleados: [],
      }
      existing.empleados.push(row)
      map.set(key, existing)
    }

    return [...map.values()].sort((a, b) => {
      if (a.fecha !== b.fecha) return b.fecha.localeCompare(a.fecha)
      return a.hora.localeCompare(b.hora)
    })
  }, [attendanceRows, locations])

  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null)
  const [addEmployeeId, setAddEmployeeId] = useState('')
  const [addingEmployee, setAddingEmployee] = useState(false)

  const handleAddEmployee = async (group: typeof groupedTurns[0]) => {
    if (!token || !addEmployeeId) return
    setAddingEmployee(true)
    try {
      await apiRequest<unknown>('/operations/turns/add-employee', {
        method: 'POST', token,
        body: {
          userId: addEmployeeId,
          fecha: group.fecha,
          hora: group.hora,
          horaFin: group.horaFin || undefined,
          locationId: group.locationId,
          titulo: group.titulo,
        },
      })
      setAddEmployeeId('')
      setAddingToGroup(null)
      await loadAdminData()
    } catch (err) {
      setTurnFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'No se pudo agregar el empleado.' })
    } finally {
      setAddingEmployee(false)
    }
  }

  const metrics = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const todayTurns = turns.filter((t) => t.fecha === today)
    return [
      { title: 'Entradas hoy',  value: todayTurns.filter((t) => t.attendance?.checkIn).length,  accent: 'green', icon: 'icon-check-circle' as const },
      { title: 'Salidas hoy',   value: todayTurns.filter((t) => t.attendance?.checkOut).length,  accent: 'blue',  icon: 'icon-activity' as const },
      { title: 'Sin confirmar', value: todayTurns.filter((t) => t.estado === 'en_proceso').length, accent: 'amber', icon: 'icon-alert-triangle' as const },
      { title: 'Sin asistencia', value: todayTurns.filter((t) => !t.attendance?.checkIn && t.estado !== 'rechazado').length, accent: 'red', icon: 'icon-x-circle' as const },
    ]
  }, [turns])

  const highlights = useMemo(() => [
    { label: 'Cargos', value: positions.length },
    { label: 'Ubicaciones', value: locations.length },
    { label: 'Invitaciones', value: invitations.length },
    { label: 'Turnos activos', value: turns.filter((t) => t.estado !== 'finalizado').length },
  ], [positions.length, locations.length, invitations.length, turns])

  // Handlers
  const handleCreatePosition = async (values: CustomFormValues) => {
    if (!token) return
    try {
      const valorHora = values.valorHora ? Number(values.valorHora) : undefined
      const created = await apiRequest<PositionResponse>(
        editingPosition ? `/positions/${editingPosition.id}` : '/positions',
        { method: editingPosition ? 'PATCH' : 'POST', token,
          body: {
            nombre: values.nombre ?? '',
            descripcion: values.descripcion ?? '',
            permissions: positionPermissions,
            valorHora: valorHora && !Number.isNaN(valorHora) ? valorHora : undefined,
          },
        },
      )
      setPositions((cur) => editingPosition ? cur.map((p) => p.id === created.id ? created : p) : [...cur, created])
      setPositionFeedback({ kind: 'success', message: `Cargo "${created.nombre}" ${editingPosition ? 'actualizado' : 'registrado'} correctamente.` })
      setEditingPosition(null)
      setActiveModal(null)
      await loadAdminData()
    } catch (err) {
      setPositionFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error al guardar cargo.' })
    }
  }

  const locationEditFields = useMemo<CustomFormField[]>(() => [
    { name: 'nombre', label: 'Punto de operacion', placeholder: 'Ej. Sede Norte', required: true, defaultValue: editingLocation?.nombre ?? '' },
    { name: 'direccion', label: 'Direccion', placeholder: 'Direccion del punto', required: true, defaultValue: editingLocation?.direccion ?? '' },
    { name: 'googleMapsUrl', label: 'Nueva URL Google Maps', placeholder: 'Deja en blanco para mantener coordenadas actuales', fullWidth: true, defaultValue: '' },
    { name: 'radioTolerancia', label: 'Radio tolerancia (m)', placeholder: 'Ej. 50', defaultValue: editingLocation?.radioTolerancia ?? '' },
    { name: 'descripcion', label: 'Descripcion', type: 'textarea' as const, placeholder: 'Detalle del punto', fullWidth: true, defaultValue: editingLocation?.descripcion ?? '' },
  ], [editingLocation])

  const handleCreateLocation = async (values: CustomFormValues) => {
    if (!token) return
    try {
      const created = await apiRequest<LocationResponse>('/locations', {
        method: 'POST', token,
        body: { nombre: values.nombre ?? '', direccion: values.direccion ?? '',
          googleMapsUrl: values.googleMapsUrl ?? '', radioTolerancia: values.radioTolerancia ?? '',
          descripcion: values.descripcion ?? '' },
      })
      setLocationFeedback({ kind: 'success', message: `Ubicacion "${created.nombre}" registrada.` })
      setActiveModal(null)
      await loadAdminData()
    } catch (err) {
      setLocationFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error al registrar ubicacion.' })
    }
  }

  const handleUpdateLocation = async (values: CustomFormValues) => {
    if (!token || !editingLocation) return
    try {
      const updated = await apiRequest<LocationResponse>(`/locations/${editingLocation.id}`, {
        method: 'PATCH', token,
        body: {
          nombre: values.nombre ?? editingLocation.nombre,
          direccion: values.direccion ?? editingLocation.direccion,
          ...(values.googleMapsUrl ? { googleMapsUrl: values.googleMapsUrl } : {}),
          radioTolerancia: values.radioTolerancia ?? editingLocation.radioTolerancia,
          descripcion: values.descripcion ?? editingLocation.descripcion,
        },
      })
      setLocationFeedback({ kind: 'success', message: `Ubicacion "${updated.nombre}" actualizada correctamente.` })
      setEditingLocation(null)
      setActiveModal(null)
      await loadAdminData()
    } catch (err) {
      setLocationFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error al actualizar la ubicacion.' })
    }
  }

  const handleDeleteLocation = async () => {
    if (!token || !editingLocation) return
    try {
      await apiRequest<null>(`/locations/${editingLocation.id}`, { method: 'DELETE', token })
      setLocationFeedback({ kind: 'success', message: `Ubicacion "${editingLocation.nombre}" eliminada.` })
      setEditingLocation(null)
      setActiveModal(null)
      await loadAdminData()
    } catch (err) {
      setLocationFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error al eliminar la ubicacion.' })
      setActiveModal(null)
    }
  }

  const handleInviteFromPosition = async (pos: PositionResponse) => {
    if (!token) return
    try {
      const inv = await apiRequest<UserInvitationResponse>('/users/invitations', {
        method: 'POST', token,
        body: { positionId: pos.id, role: 'operativo' },
      })
      setInvitationFeedback({
        kind: 'success',
        message: `Link para "${pos.nombre}": ${buildInviteLink(inv.invitePath)}`,
      })
      await loadAdminData()
    } catch (err) {
      setInvitationFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error al generar el link.' })
    }
  }

  const buildInviteLink = (invitePath: string) =>
    typeof window !== 'undefined' ? `${window.location.origin}${invitePath}` : invitePath

  const copyInviteLink = async (invitePath: string) => {
    const link = buildInviteLink(invitePath)
    try { await navigator.clipboard.writeText(link) } catch { /* fallback */ }
    setInvitationFeedback({ kind: 'success', message: `Link copiado: ${link}` })
  }

  const handleCreateInvitation = async (values: CustomFormValues) => {
    if (!token) return
    try {
      const inv = await apiRequest<UserInvitationResponse>('/users/invitations', {
        method: 'POST', token,
        body: { positionId: values.positionId || undefined, role: values.role ?? 'operativo' },
      })
      setInvitationFeedback({ kind: 'success', message: `Link generado: ${buildInviteLink(inv.invitePath)}` })
      setActiveModal(null)
      await loadAdminData()
    } catch (err) {
      setInvitationFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error al generar link.' })
    }
  }

  // Check conflicts when fecha or selected workers change
  const checkConflicts = (fecha: string, workerIds: string[]) => {
    if (!fecha || !workerIds.length) { setTurnConflicts([]); return }
    const conflicted = workerIds.filter((wid) =>
      turns.some((t) => t.assignedToUserId === wid && t.fecha === fecha && t.estado !== 'finalizado')
    )
    const names = conflicted.map((wid) => workers.find((w) => w.id === wid)?.nombreCompleto ?? wid)
    setTurnConflicts(names)
  }

  const handleCreateTurnsForMultiple = async () => {
    if (!token) return
    if (!turnForm.fecha || !turnForm.hora || !turnForm.locationId) {
      setTurnFeedback({ kind: 'error', message: 'Completa fecha, hora y ubicacion.' })
      return
    }
    if (!selectedWorkerIds.length) {
      setTurnFeedback({ kind: 'error', message: 'Selecciona al menos un empleado.' })
      return
    }
    if (turnConflicts.length) {
      setTurnFeedback({ kind: 'error', message: `Conflicto de fecha: ${turnConflicts.join(', ')} ya tienen turno ese dia.` })
      return
    }

    let created = 0
    const errors: string[] = []

    for (const workerId of selectedWorkerIds) {
      try {
        await apiRequest<TurnResponse>('/turns', {
          method: 'POST', token,
          body: {
            titulo: turnForm.titulo, descripcion: turnForm.descripcion,
            fecha: turnForm.fecha, hora: turnForm.hora,
            horaFin: turnForm.horaFin || undefined,
            assignedToUserId: workerId, locationId: turnForm.locationId,
            confirmHoursLimit: Number(turnForm.confirmHoursLimit) || 4,
          },
        })
        created++
      } catch {
        const worker = workers.find((w) => w.id === workerId)
        errors.push(worker?.nombreCompleto ?? workerId)
      }
    }

    if (created > 0) {
      setTurnFeedback({
        kind: errors.length ? 'error' : 'success',
        message: errors.length
          ? `${created} turno(s) creados. Falló: ${errors.join(', ')}.`
          : `${created} turno(s) "${turnForm.titulo}" registrados correctamente.`,
      })
      setActiveModal(null)
      setTurnForm({ titulo: '', fecha: '', hora: '', horaFin: '', locationId: '', descripcion: '', confirmHoursLimit: '4' })
      setSelectedWorkerIds([])
      setTurnConflicts([])
      await loadAdminData()
    } else {
      setTurnFeedback({ kind: 'error', message: `No se pudo crear ningún turno. ${errors.join(', ')}.` })
    }
  }

  const handleDeleteTurn = async () => {
    if (!token || !deletingTurn) return
    const turnCopy = deletingTurn
    // Close modal immediately, show feedback once done
    setActiveModal(null)
    setDeletingTurn(null)
    try {
      await apiRequest<null>(`/turns/${turnCopy.id}`, { method: 'DELETE', token })
      setTurnFeedback({ kind: 'success', message: `Turno "${turnCopy.titulo}" (${turnCopy.fecha}) eliminado correctamente.` })
      await loadAdminData()
    } catch (err) {
      setTurnFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error al eliminar el turno.' })
    }
  }

  const toggleWorker = (id: string) => {
    const next = selectedWorkerIds.includes(id)
      ? selectedWorkerIds.filter((w) => w !== id)
      : [...selectedWorkerIds, id]
    setSelectedWorkerIds(next)
    checkConflicts(turnForm.fecha, next)
  }

  const togglePermission = (perm: AccessModule) =>
    setPositionPermissions((cur) => cur.includes(perm) ? cur.filter((p) => p !== perm) : [...cur, perm])

  const statusLabel: Record<TurnResponse['estado'], string> = {
    pendiente: 'Pendiente', asignado: 'Asignado', en_proceso: 'En curso',
    finalizado: 'Finalizado', confirmado: 'Confirmado', rechazado: 'Rechazado',
  }

  const resetTurnModal = () => {
    setTurnForm({ titulo: '', fecha: '', hora: '', horaFin: '', locationId: '', descripcion: '', confirmHoursLimit: '4' })
    setSelectedWorkerIds([])
    setTurnConflicts([])
    setActiveModal(null)
  }

  // Determina si el usuario tiene acceso a esta vista
  const hasAccess = currentUser?.role === 'admin'
    || currentUser?.allowedModules?.some((m) =>
      ['geolocalizacion', 'porcentaje-asistencia', 'facturacion', 'informes', 'configuracion'].includes(m)
    )
    || currentUser?.cargo?.toLowerCase().includes('supervisor')

  if (!hasAccess) {
    return (
      <div className="pg">
        <div className="pg__access-denied">
          <Icon name="icon-shield" size={40} />
          <h2>Acceso restringido</h2>
          <p>No tienes permisos para acceder a esta seccion. Contacta al administrador.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="pg">
        <div className="pg__loading">
          <Icon name="icon-refresh" size={24} />
          <span>Cargando datos...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="pg">
      {/* Page header */}
      <div className="pg__header">
        <div>
          <h1>Gestion de asistencia</h1>
          <p>Verifica el ingreso y seguimiento operativo en tiempo real.</p>
        </div>
        <div className="pg__clock">
          <span>Hora actual</span>
          <strong>{currentTimeLabel}</strong>
        </div>
      </div>

      {/* Metrics */}
      <div className="metrics-row">
        {metrics.map((m) => (
          <div className={`metric-tile metric-tile--${m.accent}`} key={m.title}>
            <div className="metric-tile__icon">
              <Icon name={m.icon} size={20} />
            </div>
            <div className="metric-tile__body">
              <strong>{m.value}</strong>
              <span>{m.title}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="pg__section">
        <div className="section-header">
          <h2>Acciones rapidas</h2>
        </div>
        <div className="action-grid">
          <button className="action-btn action-btn--primary" type="button" onClick={() => setActiveModal('employee')}>
            <Icon name="icon-link" size={18} />
            <span>Invitar empleado</span>
          </button>
          <button className="action-btn" type="button" onClick={() => { setEditingPosition(null); setPositionPermissions(['dashboard', 'turnos-fijos']); setActiveModal('position') }}>
            <Icon name="icon-briefcase" size={18} />
            <span>Registrar cargo</span>
          </button>
          <button className="action-btn" type="button" onClick={() => setActiveModal('location')}>
            <Icon name="icon-map-pin" size={18} />
            <span>Registrar ubicacion</span>
          </button>
          <button className="action-btn action-btn--accent" type="button" onClick={() => setActiveModal('turn')}>
            <Icon name="icon-calendar" size={18} />
            <span>Crear turno</span>
          </button>
        </div>
      </div>

      {/* Feedback banners */}
      {invitationFeedback.message && (
        <div className={`feedback-banner feedback-banner--${invitationFeedback.kind}`}>
          <Icon name={invitationFeedback.kind === 'error' ? 'icon-x-circle' : 'icon-check-circle'} size={16} />
          <span>{invitationFeedback.message}</span>
          <button type="button" onClick={() => setInvitationFeedback({ kind: 'idle' })}><Icon name="icon-x" size={14} /></button>
        </div>
      )}
      {positionFeedback.message && (
        <div className={`feedback-banner feedback-banner--${positionFeedback.kind}`}>
          <Icon name={positionFeedback.kind === 'error' ? 'icon-x-circle' : 'icon-check-circle'} size={16} />
          <span>{positionFeedback.message}</span>
          <button type="button" onClick={() => setPositionFeedback({ kind: 'idle' })}><Icon name="icon-x" size={14} /></button>
        </div>
      )}
      {locationFeedback.message && (
        <div className={`feedback-banner feedback-banner--${locationFeedback.kind}`}>
          <Icon name={locationFeedback.kind === 'error' ? 'icon-x-circle' : 'icon-check-circle'} size={16} />
          <span>{locationFeedback.message}</span>
          <button type="button" onClick={() => setLocationFeedback({ kind: 'idle' })}><Icon name="icon-x" size={14} /></button>
        </div>
      )}
      {turnFeedback.message && (
        <div className={`feedback-banner feedback-banner--${turnFeedback.kind}`}>
          <Icon name={turnFeedback.kind === 'error' ? 'icon-x-circle' : 'icon-check-circle'} size={16} />
          <span>{turnFeedback.message}</span>
          <button type="button" onClick={() => setTurnFeedback({ kind: 'idle' })}><Icon name="icon-x" size={14} /></button>
        </div>
      )}

      {/* Attendance panel */}
      <div className="pg__section">
        <div className="section-header">
          <h2>Panel de asistencia</h2>
          <span className="section-header__count">{attendanceRows.length} turno(s){searchQuery ? ` · filtrando "${searchQuery}"` : ''}</span>
        </div>

        {/* ── Filtros ─────────────────────────────────────── */}
        <div className="attendance-filters">
          <label className="att-filter">
            <span>Mes</span>
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}>
              <option value="">Todos los meses</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' })
                    .format(new Date(`${m}-01T12:00:00`))}
                </option>
              ))}
            </select>
          </label>
          <label className="att-filter">
            <span>Empleado</span>
            <select value={filterWorkerId} onChange={(e) => setFilterWorkerId(e.target.value)}>
              <option value="">Todos los empleados</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.nombreCompleto}</option>)}
            </select>
          </label>
          <label className="att-filter">
            <span>Ubicacion</span>
            <select value={filterLocationId} onChange={(e) => setFilterLocationId(e.target.value)}>
              <option value="">Todas las ubicaciones</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          </label>
          {(filterMonth || filterWorkerId || filterLocationId) && (
            <button
              type="button" className="att-filter__clear"
              onClick={() => { setFilterMonth(''); setFilterWorkerId(''); setFilterLocationId('') }}
            >
              <Icon name="icon-x" size={13} /> Limpiar
            </button>
          )}
        </div>

        <div className="data-card">
          {/* ── Vista agrupada por turno (ubicación + horario) ── */}
          {groupedTurns.length ? (
            <div className="grouped-turns-list">
              {groupedTurns.map((group) => {
                const isExpanded = expandedGroup === group.key
                const totalHoras = group.empleados.reduce((s, e) => s + e.horas, 0)
                return (
                  <article key={group.key} className={`grouped-turn-card${isExpanded ? ' grouped-turn-card--expanded' : ''}`}>
                    <button
                      type="button"
                      className="grouped-turn-card__header"
                      onClick={() => setExpandedGroup(isExpanded ? null : group.key)}
                    >
                      <div className="grouped-turn-card__info">
                        <strong>{group.titulo || group.ubicacion}</strong>
                        <span>{group.fecha} · {group.hora}{group.horaFin ? ` – ${group.horaFin}` : ''}</span>
                        <span className="grouped-turn-card__location">
                          <Icon name="icon-map-pin" size={12} />
                          {group.ubicacion}
                        </span>
                      </div>
                      <div className="grouped-turn-card__stats">
                        <span className="detail-chip"><strong>{group.empleados.length}</strong> empleados</span>
                        {totalHoras > 0 && <span className="hours-badge">{fmtH(totalHoras)}</span>}
                      </div>
                      <div className="grouped-turn-card__actions-header">
                        {group.mapsUrl && (
                          <a href={group.mapsUrl} target="_blank" rel="noopener noreferrer" className="location-link"
                            onClick={(e) => e.stopPropagation()}>
                            <Icon name="icon-map-pin" size={13} /> Mapa
                          </a>
                        )}
                        <Icon name="icon-arrow-right" size={14} />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="grouped-turn-card__body">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Empleado</th>
                              <th>Entrada</th>
                              <th>Salida</th>
                              <th>Horas</th>
                              <th>Estado</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.empleados.map((row) => (
                              <tr key={row.turnId}>
                                <td>
                                  <div className="person-cell">
                                    <div className="person-cell__avatar">
                                      {row.nombre.split(' ').slice(0,2).map((p) => p[0] ?? '').join('').toUpperCase()}
                                    </div>
                                    <div className="person-cell__meta">
                                      <strong>{row.nombre}</strong>
                                      <span>{row.cargo}</span>
                                    </div>
                                  </div>
                                </td>
                                <td>{row.entrada ? <span className="attend-time attend-time--in">{row.entrada}</span> : '—'}</td>
                                <td>{row.salida ? <span className="attend-time attend-time--out">{row.salida}</span> : '—'}</td>
                                <td>{row.horas > 0 ? <span className="hours-badge">{fmtH(row.horas)}</span> : '—'}</td>
                                <td><span className={`status-badge status-badge--${row.estado}`}>{statusLabel[row.estado]}</span></td>
                                <td>
                                  <button className="table-action-btn table-action-btn--delete" type="button" title="Quitar del turno"
                                    onClick={() => { setDeletingTurn(row.turnObj); setActiveModal('turn-delete') }}>
                                    <Icon name="icon-x-circle" size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {/* Botón agregar empleado al turno */}
                        <div className="grouped-turn-card__add">
                          <Button type="button" size="sm" variant="ghost"
                            onClick={() => setAddingToGroup(group.key === addingToGroup ? null : group.key)}>
                            <Icon name="icon-plus" size={13} /> Agregar empleado
                          </Button>
                          {addingToGroup === group.key && (
                            <div className="add-employee-inline">
                              <select
                                value={addEmployeeId}
                                onChange={(e) => setAddEmployeeId(e.target.value)}
                                className="att-filter select"
                              >
                                <option value="">Selecciona un empleado</option>
                                {workers
                                  .filter((w) => !group.empleados.some((e) => e.workerId === w.id))
                                  .map((w) => <option key={w.id} value={w.id}>{w.nombreCompleto} — {w.cargo}</option>)
                                }
                              </select>
                              <Button type="button" size="sm" variant="primary"
                                disabled={!addEmployeeId || addingEmployee}
                                onClick={() => void handleAddEmployee(group)}>
                                {addingEmployee ? 'Agregando...' : 'Confirmar'}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          ) : (
            <p className="table-empty" style={{ padding: '1.5rem', textAlign: 'center' }}>
              {turns.length === 0 ? 'No hay turnos registrados.' : 'Sin resultados para los filtros aplicados.'}
            </p>
          )}
        </div>
      </div>

      {/* ── Cuenta de cobro ──────────────────────────────── */}
      {billingRows.length > 0 && (
        <div className="pg__section">
          <div className="section-header">
            <h2>Cuenta de cobro</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
              <span className="section-header__count">
                {billingRows.length} empleado(s) · <strong>{fmtH(totalBillingHours)}</strong> totales
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={exportBillingCSV}>
                <Icon name="icon-activity" size={14} /> Exportar CSV
              </Button>
            </div>
          </div>
          <div className="data-card">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Documento</th>
                    <th>Cargo</th>
                    <th>Días trab.</th>
                    <th>Turnos</th>
                    <th>Horas totales</th>
                  </tr>
                </thead>
                <tbody>
                  {billingRows.map((r) => (
                    <tr key={r.workerId}>
                      <td>
                        <div className="person-cell">
                          <div className="person-cell__avatar">
                            {r.nombre.split(' ').slice(0,2).map((p) => p[0] ?? '').join('').toUpperCase()}
                          </div>
                          <div className="person-cell__meta">
                            <strong>{r.nombre}</strong>
                            <span>{r.cargo}</span>
                          </div>
                        </div>
                      </td>
                      <td><span className="turn-cell__schedule">{r.documento || '—'}</span></td>
                      <td><span className="turn-cell__schedule">{r.cargo}</span></td>
                      <td><span className="hours-badge">{r.dias}</span></td>
                      <td>{r.turnos}</td>
                      <td>
                        <span className="hours-total-badge">{fmtH(r.horasTotales)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="billing-total-row">
                    <td colSpan={5}><strong>Total</strong></td>
                    <td><span className="hours-total-badge">{fmtH(totalBillingHours)}</span></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Highlights strip */}
      <div className="highlight-strip">
        {highlights.map((h) => (
          <div className="highlight-chip" key={h.label}>
            <strong>{h.value}</strong>
            <span>{h.label}</span>
          </div>
        ))}
      </div>

      {/* Workers */}
      <div className="pg__section">
        <div className="section-header">
          <h2>Empleados operativos</h2>
          <span className="section-header__count">{workers.length} registrados</span>
        </div>
        <div className="card-grid">
          {workers.length ? workers.map((w) => (
            <div className="info-card" key={w.id}>
              <div className="info-card__header">
                <div className="info-card__avatar">{w.nombreCompleto.split(' ').slice(0,2).map((p) => p[0] ?? '').join('').toUpperCase()}</div>
                <div>
                  <strong>{w.nombreCompleto}</strong>
                  <span className="status-badge status-badge--asignado">{w.role}</span>
                </div>
              </div>
              <p className="info-card__detail"><Icon name="icon-briefcase" size={13} />{w.cargo}</p>
              <p className="info-card__detail"><Icon name="icon-user" size={13} />{w.correo}</p>
              <p className="info-card__detail"><Icon name="icon-building" size={13} />{companyName}</p>
            </div>
          )) : (
            <div className="info-card info-card--empty">
              <Icon name="icon-users" size={28} />
              <strong>Sin empleados</strong>
              <p>Genera un link de invitacion para registrar el primer integrante.</p>
            </div>
          )}
        </div>
      </div>

      {/* Invitations */}
      <div className="pg__section">
        <div className="section-header">
          <h2>Links de invitacion</h2>
          <span className="section-header__count">{invitations.length} generados</span>
        </div>
        <div className="card-grid">
          {invitations.length ? invitations.map((inv) => (
            <div className="info-card" key={inv.id}>
              <div className="info-card__header">
                <div className="info-card__icon"><Icon name="icon-link" size={18} /></div>
                <div>
                  <strong>{inv.cargo}</strong>
                  <span className={`status-badge ${inv.status === 'completada' ? 'status-badge--finalizado' : 'status-badge--pendiente'}`}>{inv.status}</span>
                </div>
              </div>
              <p className="info-card__detail"><Icon name="icon-briefcase" size={13} />Rol: {inv.role}</p>
              <p className="info-card__url">{buildInviteLink(inv.invitePath)}</p>
              <div className="info-card__actions">
                <Button type="button" variant="ghost" size="sm" onClick={() => void copyInviteLink(inv.invitePath)}>
                  <Icon name="icon-copy" size={14} /> Copiar link
                </Button>
              </div>
            </div>
          )) : (
            <div className="info-card info-card--empty">
              <Icon name="icon-link" size={28} />
              <strong>Sin invitaciones</strong>
              <p>Los links generados apareceran aqui.</p>
            </div>
          )}
        </div>
      </div>

      {/* Positions */}
      <div className="pg__section">
        <div className="section-header">
          <h2>Cargos configurados</h2>
          <span className="section-header__count">{positions.length} cargos</span>
        </div>
        <div className="card-grid">
          {positions.length ? positions.map((pos) => (
            <div className="info-card" key={pos.id}>
              <div className="info-card__header">
                <div className="info-card__icon"><Icon name="icon-briefcase" size={18} /></div>
                <div>
                  <strong>{pos.nombre}</strong>
                  <span className="status-badge status-badge--asignado">cargo</span>
                </div>
              </div>
              <p className="info-card__detail">{pos.descripcion ?? 'Sin descripcion'}</p>
              <p className="info-card__detail">
                <Icon name="icon-shield" size={13} />
                {pos.permissions.length ? pos.permissions.map((p) => accessModuleLabels[p]).join(', ') : 'Sin accesos'}
              </p>
              <div className="info-card__actions">
                <Button type="button" variant="ghost" size="sm" onClick={() => {
                  setEditingPosition(pos)
                  setPositionPermissions(pos.permissions?.length ? pos.permissions : ['dashboard', 'turnos-fijos'])
                  setActiveModal('position')
                }}>
                  <Icon name="icon-edit" size={14} /> Configurar
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => void handleInviteFromPosition(pos)}>
                  <Icon name="icon-link" size={14} /> Generar link
                </Button>
              </div>
            </div>
          )) : (
            <div className="info-card info-card--empty">
              <Icon name="icon-briefcase" size={28} />
              <strong>Sin cargos</strong>
              <p>Registra el primer cargo desde acciones rapidas.</p>
            </div>
          )}
        </div>
      </div>

      {/* Locations table */}
      <div className="pg__section">
        <div className="section-header">
          <h2>Ubicaciones operativas</h2>
          <span className="section-header__count">{locations.length} puntos</span>
        </div>
        <div className="data-card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Punto</th>
                  <th>Direccion</th>
                  <th>Latitud</th>
                  <th>Longitud</th>
                  <th>Radio (m)</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {locations.length ? locations.map((loc) => (
                  <tr key={loc.id}>
                    <td><strong>{loc.nombre}</strong></td>
                    <td>{loc.direccion ?? '-'}</td>
                    <td>{loc.latitud ?? '-'}</td>
                    <td>{loc.longitud ?? '-'}</td>
                    <td>{loc.radioTolerancia ?? '-'}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="table-action-btn table-action-btn--edit"
                          type="button"
                          title="Editar ubicacion"
                          onClick={() => { setEditingLocation(loc); setActiveModal('location-edit') }}
                        >
                          <Icon name="icon-edit" size={14} />
                        </button>
                        <button
                          className="table-action-btn table-action-btn--delete"
                          type="button"
                          title="Eliminar ubicacion"
                          onClick={() => { setEditingLocation(loc); setActiveModal('location-delete') }}
                        >
                          <Icon name="icon-x-circle" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="table-empty">Sin ubicaciones registradas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal: Invitar empleado */}
      <Modal open={activeModal === 'employee'} title="Invitar empleado" description={`Link para unirse a ${companyName || 'tu empresa'}.`} onClose={() => setActiveModal(null)}>
        <CustomForm title="" fields={invitationFields} submitLabel="Generar link" showReset={false} onSubmit={(v) => void handleCreateInvitation(v)} />
      </Modal>

      {/* Modal: Cargo */}
      <Modal open={activeModal === 'position'} title={editingPosition ? 'Editar cargo' : 'Registrar cargo'} onClose={() => { setEditingPosition(null); setActiveModal(null) }}>
        <CustomForm key={editingPosition?.id ?? 'new'} title="" fields={positionFormFields}
          submitLabel={editingPosition ? 'Guardar cambios' : 'Registrar cargo'} showReset={false}
          onSubmit={(v) => void handleCreatePosition(v)} />
        <div className="access-picker">
          <div className="access-picker__header">
            <h4>Permisos de acceso</h4>
            <p>Define que modulos puede ver este cargo.</p>
          </div>
          <div className="access-picker__grid">
            {positionAccessOptions.map((opt) => (
              <button key={opt.value} type="button"
                className={`access-picker__item${positionPermissions.includes(opt.value) ? ' access-picker__item--on' : ''}`}
                onClick={() => togglePermission(opt.value)}>
                <strong>{opt.label}</strong>
                <span>{opt.description}</span>
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* Modal: Ubicacion nueva */}
      <Modal open={activeModal === 'location'} title="Registrar ubicacion" onClose={() => setActiveModal(null)}>
        <CustomForm title="" fields={locationFields} submitLabel="Guardar ubicacion" showReset={false} onSubmit={(v) => void handleCreateLocation(v)} />
      </Modal>

      {/* Modal: Editar ubicacion */}
      <Modal
        open={activeModal === 'location-edit'}
        title={`Editar: ${editingLocation?.nombre ?? ''}`}
        description="Modifica los datos del punto operativo. Deja la URL de Maps en blanco para conservar las coordenadas actuales."
        onClose={() => { setEditingLocation(null); setActiveModal(null) }}
      >
        <CustomForm
          key={editingLocation?.id ?? 'edit-loc'}
          title=""
          fields={locationEditFields}
          submitLabel="Guardar cambios"
          showReset={false}
          onSubmit={(v) => void handleUpdateLocation(v)}
        />
      </Modal>

      {/* Modal: Confirmar eliminacion */}
      <Modal
        open={activeModal === 'location-delete'}
        title="Eliminar ubicacion"
        description={`¿Seguro que deseas eliminar "${editingLocation?.nombre ?? ''}"? Esta accion no se puede deshacer.`}
        onClose={() => { setEditingLocation(null); setActiveModal(null) }}
      >
        <div className="confirm-actions">
          <Button type="button" variant="ghost" onClick={() => { setEditingLocation(null); setActiveModal(null) }}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" className="btn-danger" onClick={() => void handleDeleteLocation()}>
            <Icon name="icon-x-circle" size={16} /> Eliminar
          </Button>
        </div>
      </Modal>

      {/* Modal: Turno con multiselección */}
      <Modal open={activeModal === 'turn'} title="Crear turno" description="Selecciona uno o varios empleados para asignarlos al mismo turno." onClose={resetTurnModal}>
        <div className="turn-form">
          <div className="turn-form__fields">
            <label className="turn-form__field">
              <span>Fecha <span className="req">*</span></span>
              <input type="date" value={turnForm.fecha}
                onChange={(e) => { const v = e.target.value; setTurnForm((f) => ({ ...f, fecha: v })); checkConflicts(v, selectedWorkerIds) }} />
            </label>
            <label className="turn-form__field">
              <span>Hora inicio <span className="req">*</span></span>
              <input type="time" value={turnForm.hora}
                onChange={(e) => setTurnForm((f) => ({ ...f, hora: e.target.value }))} />
            </label>
            <label className="turn-form__field">
              <span>Hora fin</span>
              <input type="time" value={turnForm.horaFin}
                onChange={(e) => setTurnForm((f) => ({ ...f, horaFin: e.target.value }))} />
            </label>
            <label className="turn-form__field">
              <span>Horas para confirmar</span>
              <select value={turnForm.confirmHoursLimit}
                onChange={(e) => setTurnForm((f) => ({ ...f, confirmHoursLimit: e.target.value }))}>
                <option value="1">1 hora antes</option>
                <option value="2">2 horas antes</option>
                <option value="4">4 horas antes</option>
                <option value="6">6 horas antes</option>
                <option value="8">8 horas antes</option>
                <option value="12">12 horas antes</option>
              </select>
            </label>
            <label className="turn-form__field turn-form__field--full">
              <span>Ubicacion <span className="req">*</span></span>
              <select value={turnForm.locationId}
                onChange={(e) => {
                  const locId = e.target.value
                  const loc = locations.find((l) => l.id === locId)
                  setTurnForm((f) => ({ ...f, locationId: locId, titulo: loc?.nombre ?? '' }))
                }}>
                <option value="">Selecciona una ubicacion</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.nombre}{l.direccion ? ` · ${l.direccion}` : ''}</option>
                ))}
              </select>
            </label>
            <label className="turn-form__field turn-form__field--full">
              <span>Descripcion</span>
              <textarea rows={2} placeholder="Detalle opcional del turno" value={turnForm.descripcion}
                onChange={(e) => setTurnForm((f) => ({ ...f, descripcion: e.target.value }))} />
            </label>
          </div>

          <div className="turn-form__workers">
            <div className="turn-form__workers-header">
              <span>Empleados <span className="req">*</span></span>
              <span className="turn-form__sel-count">{selectedWorkerIds.length} seleccionados</span>
            </div>
            {workers.length ? (
              <div className="turn-form__worker-list">
                {workers.map((w) => {
                  const isSelected = selectedWorkerIds.includes(w.id)
                  const hasConflict = turnConflicts.includes(w.nombreCompleto)
                  return (
                    <button
                      key={w.id}
                      type="button"
                      className={`worker-chip${isSelected ? ' worker-chip--on' : ''}${hasConflict ? ' worker-chip--conflict' : ''}`}
                      onClick={() => toggleWorker(w.id)}
                    >
                      <span className="worker-chip__avatar">{w.nombreCompleto.split(' ').slice(0,2).map((p) => p[0] ?? '').join('').toUpperCase()}</span>
                      <span className="worker-chip__meta">
                        <strong>{w.nombreCompleto}</strong>
                        <small>{w.cargo}</small>
                      </span>
                      {hasConflict && <span className="worker-chip__warn" title="Ya tiene turno en esa fecha"><Icon name="icon-alert-triangle" size={13} /></span>}
                      {isSelected && !hasConflict && <span className="worker-chip__check"><Icon name="icon-check" size={13} /></span>}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="turn-form__no-workers">No hay empleados operativos registrados.</p>
            )}
            {turnConflicts.length > 0 && (
              <p className="turn-form__conflict-warn">
                <Icon name="icon-alert-triangle" size={14} />
                {turnConflicts.join(', ')} ya {turnConflicts.length === 1 ? 'tiene' : 'tienen'} turno el {turnForm.fecha}. No se puede asignar.
              </p>
            )}
          </div>

          <div className="confirm-actions">
            <Button type="button" variant="ghost" onClick={resetTurnModal}>Cancelar</Button>
            <Button type="button" variant="primary" onClick={() => void handleCreateTurnsForMultiple()}
              disabled={!selectedWorkerIds.length || turnConflicts.length > 0 || !turnForm.fecha || !turnForm.hora || !turnForm.locationId}>
              <Icon name="icon-calendar" size={15} /> Crear {selectedWorkerIds.length > 1 ? `${selectedWorkerIds.length} turnos` : 'turno'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Confirmar eliminacion de turno */}
      <Modal
        open={activeModal === 'turn-delete'}
        title="Eliminar turno"
        description={`¿Eliminar el turno "${deletingTurn?.titulo ?? ''}" del ${deletingTurn?.fecha ?? ''} asignado a ${deletingTurn?.assignedToUserName ?? 'este empleado'}? Esta accion no se puede deshacer.`}
        onClose={() => { setDeletingTurn(null); setActiveModal(null) }}
      >
        <div className="confirm-actions">
          <Button type="button" variant="ghost" onClick={() => { setDeletingTurn(null); setActiveModal(null) }}>Cancelar</Button>
          <Button type="button" variant="primary" className="btn-danger" onClick={() => void handleDeleteTurn()}>
            <Icon name="icon-x-circle" size={16} /> Eliminar turno
          </Button>
        </div>
      </Modal>
    </div>
  )
}
