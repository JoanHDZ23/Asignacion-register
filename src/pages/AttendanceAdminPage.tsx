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
type ActiveModal = 'employee' | 'position' | 'location' | 'location-edit' | 'location-delete' | 'turn' | 'turn-delete' | 'turn-edit' | 'worker-edit' | 'worker-delete' | null

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

// ── Permisos clasificados por nivel de rol (empresa) ─────────────────────
type PermissionGroup = {
  title: string
  description: string
  tag: string // etiqueta de nivel
  modules: AccessModule[]
}

const empresaPermissionGroups: PermissionGroup[] = [
  {
    title: 'Operativo',
    description: 'Permisos básicos para empleados de campo.',
    tag: 'Empleado',
    modules: ['dashboard', 'turnos-fijos', 'biometria-facial'],
  },
  {
    title: 'Supervisor',
    description: 'Control de personal y validación de asistencia.',
    tag: 'Supervisor',
    modules: ['geolocalizacion', 'turnos-rotativos', 'permisos-ausencias', 'informes'],
  },
  {
    title: 'Analista / Facturación',
    description: 'Gestión de horas, recargos y cuentas de cobro.',
    tag: 'Analista',
    modules: ['horas-extras-recargos', 'facturacion', 'teletrabajo'],
  },
  {
    title: 'Gerencia / Administración',
    description: 'Configuración total del sistema.',
    tag: 'Gerencia',
    modules: ['configuracion'],
  },
]

const academiaPermissionGroups: PermissionGroup[] = [
  {
    title: 'Estudiante',
    description: 'Permisos básicos para alumnos.',
    tag: 'Estudiante',
    modules: ['dashboard', 'codigo-qr', 'porcentaje-asistencia', 'justificaciones'],
  },
  {
    title: 'Docente',
    description: 'Control de asistencia en clases y eventos.',
    tag: 'Docente',
    modules: ['asistencia-clase', 'asistencia-docente', 'eventos-talleres'],
  },
  {
    title: 'Coordinación / Admin',
    description: 'Alertas, informes y configuración institucional.',
    tag: 'Coordinación',
    modules: ['alertas-inasistencia', 'informes', 'configuracion'],
  },
]

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
  const isSupervisor = currentUser?.role === 'supervisor'
    || (currentUser?.role !== 'admin' && Boolean(currentUser?.cargo?.toLowerCase().includes('supervisor')))
  const [searchParams] = useSearchParams()
  const searchQuery = searchParams.get('q')?.toLowerCase() ?? ''

  const [loading, setLoading] = useState(true)
  const [positions, setPositions] = useState<PositionResponse[]>([])
  const [locations, setLocations] = useState<LocationResponse[]>([])
  const [workers, setWorkers] = useState<UserResponse[]>([])
  const [invitations, setInvitations] = useState<UserInvitationResponse[]>([])
  const [turns, setTurns] = useState<TurnResponse[]>([])
  const [companyName, setCompanyName] = useState('')
  const [companyType, setCompanyType] = useState<'empresa' | 'academia'>('empresa')

  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  const [editingPosition, setEditingPosition] = useState<PositionResponse | null>(null)
  const [positionPermissions, setPositionPermissions] = useState<AccessModule[]>(['dashboard', 'turnos-fijos'])
  const [editingLocation, setEditingLocation] = useState<LocationResponse | null>(null)
  const [editingWorker, setEditingWorker] = useState<UserResponse | null>(null)
  const [deletingWorker, setDeletingWorker] = useState<UserResponse | null>(null)
  const [hoursModalOpen, setHoursModalOpen] = useState(false)
  const [hoursData, setHoursData] = useState<{ records: any[]; summary: any } | null>(null)
  const [hoursLoading, setHoursLoading] = useState(false)
  const [hoursFilterUser, setHoursFilterUser] = useState('')
  const [hoursRange, setHoursRange] = useState<'15' | '30'>('15')
  const [billingFilterWorker, setBillingFilterWorker] = useState('')
  const [billingPeriod, setBillingPeriod] = useState<'' | '1' | '2'>('')
  const [detailWorkerId, setDetailWorkerId] = useState<string | null>(null)

  // Multi-employee turn form state
  const [turnForm, setTurnForm] = useState({
    titulo: '', fecha: '', hora: '', horaFin: '', locationId: '', descripcion: '', confirmHoursLimit: '4',
  })
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([])
  const [turnConflicts, setTurnConflicts] = useState<string[]>([])
  const [deletingTurn, setDeletingTurn] = useState<TurnResponse | null>(null)
  const [editingTurnData, setEditingTurnData] = useState<{ turn: TurnResponse; fecha: string; hora: string; horaFin: string; locationId: string } | null>(null)

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
      const isManagement = currentUser?.role === 'admin' || currentUser?.role === 'supervisor'
        || currentUser?.cargo?.toLowerCase().includes('supervisor')

      if (isManagement) {
        const response = await apiRequest<CompanyManagementResponse>('/companies/management', { token })
        setPositions(response.positions)
        setWorkers(response.users.filter((u) => u.role !== 'admin'))
        setLocations(response.locations)
        setInvitations(response.invitations)
        setTurns(response.turns)
        if (response.company?.nombre) setCompanyName(response.company.nombre)
        if (response.company?.tipo) setCompanyType(response.company.tipo)
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

      // Filtro por empleado en cuenta de cobro
      if (billingFilterWorker && row.workerId !== billingFilterWorker) continue

      // Filtro por quincena (1a mitad: días 1-15, 2a mitad: días 16-fin de mes)
      if (billingPeriod && row.fecha) {
        const day = new Date(row.fecha + 'T12:00:00').getDate()
        if (billingPeriod === '1' && day > 15) continue
        if (billingPeriod === '2' && day <= 15) continue
      }

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
  }, [attendanceRows, workers, billingFilterWorker, billingPeriod])

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

  // ── Turnos agrupados por ubicación ─────────────────────────
  type GroupedByLocation = {
    key: string
    ubicacion: string
    locationId: string
    mapsUrl: string | null
    turnos: Array<{
      subKey: string
      fecha: string
      hora: string
      horaFin: string
      titulo: string
      empleados: typeof attendanceRows
    }>
  }

  const groupedTurns = useMemo(() => {
    const locationMap = new Map<string, GroupedByLocation>()

    for (const row of attendanceRows) {
      const locKey = row.locationId || row.ubicacion || 'sin-ubicacion'
      const loc = locations.find((l) => l.id === row.locationId)
      const mapsUrl = loc?.latitud && loc?.longitud
        ? `https://www.google.com/maps?q=${loc.latitud},${loc.longitud}`
        : null

      if (!locationMap.has(locKey)) {
        locationMap.set(locKey, {
          key: locKey,
          ubicacion: row.ubicacion || 'Sin ubicación',
          locationId: row.locationId,
          mapsUrl,
          turnos: [],
        })
      }

      const locGroup = locationMap.get(locKey)!
      const subKey = `${row.fecha}|${row.horarioTurno}`
      let turnoGroup = locGroup.turnos.find((t) => t.subKey === subKey)
      if (!turnoGroup) {
        turnoGroup = {
          subKey,
          fecha: row.fecha,
          hora: row.horarioTurno.split(' – ')[0] ?? '',
          horaFin: row.horarioTurno.split(' – ')[1] ?? '',
          titulo: row.turnoTitulo,
          empleados: [],
        }
        locGroup.turnos.push(turnoGroup)
      }
      turnoGroup.empleados.push(row)
    }

    // Ordena turnos dentro de cada ubicación por fecha desc, hora asc
    for (const group of locationMap.values()) {
      group.turnos.sort((a, b) => {
        if (a.fecha !== b.fecha) return b.fecha.localeCompare(a.fecha)
        return a.hora.localeCompare(b.hora)
      })
    }

    return [...locationMap.values()].sort((a, b) => a.ubicacion.localeCompare(b.ubicacion))
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

  const loadHoursHistory = async (days: '15' | '30', userId?: string) => {
    if (!token) return
    setHoursLoading(true)
    try {
      const to = new Date().toISOString().slice(0, 10)
      const fromDate = new Date()
      fromDate.setDate(fromDate.getDate() - Number(days))
      const from = fromDate.toISOString().slice(0, 10)
      const params = new URLSearchParams({ from, to })
      if (userId) params.set('userId', userId)
      const result = await apiRequest<{ records: any[]; summary: any }>(`/turns/hours-history?${params.toString()}`, { token })
      setHoursData(result)
    } catch {
      setHoursData({ records: [], summary: { total: 0, totalHoras: 0, totalOrdinarias: 0, totalDominicales: 0, totalFestivas: 0 } })
    } finally {
      setHoursLoading(false)
    }
  }

  const openHoursModal = () => {
    setHoursModalOpen(true)
    void loadHoursHistory(hoursRange, hoursFilterUser || undefined)
  }

  const handleEditWorker = async (values: Record<string, string>) => {
    if (!token || !editingWorker) return
    try {
      await apiRequest(`/users/${editingWorker.id}`, {
        method: 'PATCH',
        token,
        body: {
          nombreCompleto: values.nombreCompleto,
          correo: values.correo,
          telefono: values.telefono,
          cargo: values.cargo,
          positionId: values.positionId || undefined,
        },
      })
      setActiveModal(null)
      setEditingWorker(null)
      await loadAdminData()
    } catch (err) {
      setTurnFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error al actualizar empleado.' })
    }
  }

  const handleDeleteWorker = async () => {
    if (!token || !deletingWorker) return
    try {
      await apiRequest(`/users/${deletingWorker.id}`, { method: 'DELETE', token })
      setActiveModal(null)
      setDeletingWorker(null)
      await loadAdminData()
    } catch (err) {
      setTurnFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error al eliminar empleado.' })
    }
  }

  const openEditTurn = (turn: TurnResponse) => {
    setEditingTurnData({
      turn,
      fecha: turn.fecha,
      hora: turn.hora ?? '',
      horaFin: turn.horaFin ?? '',
      locationId: turn.locationId ?? '',
    })
    setActiveModal('turn-edit')
  }

  const handleUpdateTurnDetails = async () => {
    if (!token || !editingTurnData) return
    const { turn, fecha, hora, horaFin, locationId } = editingTurnData
    const loc = locations.find((l) => l.id === locationId)
    try {
      await apiRequest<TurnResponse>(`/turns/${turn.id}/status`, {
        method: 'PATCH',
        token,
        body: { estado: turn.estado },
      }).catch(() => {}) // silently ignore if status doesn't change

      // Use a general PATCH on the turn
      await apiRequest<TurnResponse>(`/turns/${turn.id}`, {
        method: 'PATCH',
        token,
        body: { fecha, hora, horaFin, locationId, locationNombre: loc?.nombre },
      })
      setTurnFeedback({ kind: 'success', message: `Turno "${turn.titulo}" actualizado correctamente.` })
      setActiveModal(null)
      setEditingTurnData(null)
      await loadAdminData()
    } catch (err) {
      setTurnFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error al actualizar el turno.' })
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
    || currentUser?.role === 'supervisor'
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

      {/* Quick actions — admin: all actions, supervisor: only invite */}
      {(currentUser?.role === 'admin' || isSupervisor) && (
      <div className="pg__section">
        <div className="section-header">
          <h2>Acciones rapidas</h2>
        </div>
        <div className="action-grid">
          <button className="action-btn action-btn--primary" type="button" onClick={() => setActiveModal('employee')}>
            <Icon name="icon-link" size={18} />
            <span>Invitar empleado</span>
          </button>
          {currentUser?.role === 'admin' && (
            <>
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
            </>
          )}
        </div>
      </div>
      )}

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
            <span className="section-header__count">{attendanceRows.length} turno(s){searchQuery ? ` · filtrando "${searchQuery}"` : ''}</span>
            <Button type="button" variant="ghost" size="sm" onClick={openHoursModal}>
              <Icon name="icon-clock" size={14} /> Historial horas
            </Button>
          </div>
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
          {/* ── Vista agrupada por ubicación ── */}
          {groupedTurns.length ? (
            <div className="grouped-turns-list">
              {groupedTurns.map((locGroup) => (
                <div key={locGroup.key} className="location-group">
                  <div className="location-group__header">
                    <div className="location-group__title">
                      <Icon name="icon-map-pin" size={16} />
                      <strong>{locGroup.ubicacion}</strong>
                      <span className="detail-chip"><strong>{locGroup.turnos.reduce((s, t) => s + t.empleados.length, 0)}</strong> asignaciones</span>
                    </div>
                    {locGroup.mapsUrl && (
                      <a href={locGroup.mapsUrl} target="_blank" rel="noopener noreferrer" className="location-link">
                        <Icon name="icon-map-pin" size={13} /> Ver en mapa
                      </a>
                    )}
                  </div>
                  <div className="location-group__turnos">
                    {locGroup.turnos.map((turno) => {
                      const subKey = `${locGroup.key}|${turno.subKey}`
                      const isExpanded = expandedGroup === subKey
                      const totalHoras = turno.empleados.reduce((s, e) => s + e.horas, 0)
                      return (
                        <article key={subKey} className={`grouped-turn-card${isExpanded ? ' grouped-turn-card--expanded' : ''}`}>
                          <button
                            type="button"
                            className="grouped-turn-card__header"
                            onClick={() => setExpandedGroup(isExpanded ? null : subKey)}
                          >
                            <div className="grouped-turn-card__info">
                              <strong>{turno.fecha}</strong>
                              <span>{turno.hora}{turno.horaFin ? ` – ${turno.horaFin}` : ''}</span>
                            </div>
                            <div className="grouped-turn-card__stats">
                              <span className="detail-chip"><strong>{turno.empleados.length}</strong> empleados</span>
                              {totalHoras > 0 && <span className="hours-badge">{fmtH(totalHoras)}</span>}
                            </div>
                            <div className="grouped-turn-card__actions-header">
                              <Icon name={isExpanded ? 'icon-arrow-down' : 'icon-arrow-right'} size={14} />
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
                                  {turno.empleados.map((row) => (
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
                                        {currentUser?.role === 'admin' && (
                                          <button className="table-action-btn table-action-btn--delete" type="button" title="Quitar del turno"
                                            onClick={() => { setDeletingTurn(row.turnObj); setActiveModal('turn-delete') }}>
                                            <Icon name="icon-x-circle" size={14} />
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {/* Acciones del turno (solo admin) */}
                              {currentUser?.role === 'admin' && (
                                <div className="grouped-turn-card__add">
                                  <Button type="button" size="sm" variant="ghost"
                                    onClick={() => openEditTurn(turno.empleados[0]?.turnObj as TurnResponse)}>
                                    <Icon name="icon-clipboard" size={13} /> Editar turno
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost"
                                    onClick={() => setAddingToGroup(subKey === addingToGroup ? null : subKey)}>
                                    <Icon name="icon-plus" size={13} /> Agregar empleado
                                  </Button>
                                  {addingToGroup === subKey && (
                                    <div className="add-employee-inline">
                                      <select
                                        value={addEmployeeId}
                                        onChange={(e) => setAddEmployeeId(e.target.value)}
                                        className="att-filter select"
                                      >
                                        <option value="">Selecciona un empleado</option>
                                        {workers
                                          .filter((w) => !turno.empleados.some((e) => e.workerId === w.id))
                                          .map((w) => <option key={w.id} value={w.id}>{w.nombreCompleto} — {w.cargo}</option>)
                                        }
                                      </select>
                                      <Button type="button" size="sm" variant="primary"
                                        disabled={!addEmployeeId || addingEmployee}
                                        onClick={() => void handleAddEmployee({ ...turno, key: subKey, ubicacion: locGroup.ubicacion, locationId: locGroup.locationId, mapsUrl: locGroup.mapsUrl } as any)}>
                                        {addingEmployee ? 'Agregando...' : 'Confirmar'}
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="table-empty" style={{ padding: '1.5rem', textAlign: 'center' }}>
              {turns.length === 0 ? 'No hay turnos registrados.' : 'Sin resultados para los filtros aplicados.'}
            </p>
          )}
        </div>
      </div>

      {/* ── Cuenta de cobro ──────────────────────────────── */}
      <div className="pg__section">
        <div className="section-header">
          <h2>Cuenta de cobro</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
            <Button type="button" variant="ghost" size="sm" onClick={openHoursModal}>
              <Icon name="icon-clock" size={14} /> Historial de horas
            </Button>
            <span className="section-header__count">
              {billingRows.length} empleado(s) · <strong>{fmtH(totalBillingHours)}</strong> totales
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={exportBillingCSV}>
              <Icon name="icon-activity" size={14} /> Exportar CSV
            </Button>
          </div>
        </div>

        {/* Filtros de cuenta de cobro */}
        <div className="filters-row" style={{ marginBottom: '.75rem' }}>
          <label className="att-filter">
            <span>Empleado</span>
            <select value={billingFilterWorker} onChange={(e) => setBillingFilterWorker(e.target.value)}>
              <option value="">Todos los empleados</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.nombreCompleto}</option>)}
            </select>
          </label>
          <label className="att-filter">
            <span>Quincena</span>
            <select value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value as '' | '1' | '2')}>
              <option value="">Todo el mes</option>
              <option value="1">1ª quincena (1-15)</option>
              <option value="2">2ª quincena (16-fin)</option>
            </select>
          </label>
          {(billingFilterWorker || billingPeriod) && (
            <button type="button" className="att-filter__clear"
              onClick={() => { setBillingFilterWorker(''); setBillingPeriod('') }}>
              <Icon name="icon-x" size={13} /> Limpiar
            </button>
          )}
        </div>

        {billingRows.length > 0 ? (
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
        ) : (
          <p style={{ textAlign: 'center', padding: '1rem', color: 'var(--clr-text-2)' }}>Sin registros de horas para los filtros seleccionados.</p>
        )}
      </div>

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
              <div className="info-card__actions">
                <Button type="button" size="sm" variant="ghost" onClick={() => setDetailWorkerId(w.id)}>
                  <Icon name="icon-eye" size={13} /> Ver detalles
                </Button>
                {currentUser?.role === 'admin' && (
                  <>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingWorker(w); setActiveModal('worker-edit') }}>
                      <Icon name="icon-clipboard" size={13} /> Editar
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="btn-danger-text" onClick={() => { setDeletingWorker(w); setActiveModal('worker-delete') }}>
                      <Icon name="icon-x-circle" size={13} /> Eliminar
                    </Button>
                  </>
                )}
              </div>
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
          <span className="section-header__count">{invitations.filter((i) => i.status === 'pendiente' && (!i.expiresAt || new Date(i.expiresAt) > new Date())).length} activos</span>
        </div>
        <div className="card-grid">
          {invitations.length ? invitations
            .filter((inv) => {
              // Oculta expiradas pendientes
              if (inv.status === 'pendiente' && inv.expiresAt && new Date(inv.expiresAt) <= new Date()) return false
              return true
            })
            .map((inv) => {
              const isExpired = inv.status === 'pendiente' && inv.expiresAt && new Date(inv.expiresAt) <= new Date()
              const remainingMs = inv.expiresAt ? new Date(inv.expiresAt).getTime() - Date.now() : 0
              const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000))
              return (
                <div className="info-card" key={inv.id}>
                  <div className="info-card__header">
                    <div className="info-card__icon"><Icon name="icon-link" size={18} /></div>
                    <div>
                      <strong>{inv.cargo}</strong>
                      <span className={`status-badge ${inv.status === 'completada' ? 'status-badge--finalizado' : inv.status === 'pendiente' ? 'status-badge--pendiente' : 'status-badge--rechazado'}`}>{inv.status}</span>
                    </div>
                  </div>
                  <p className="info-card__detail"><Icon name="icon-briefcase" size={13} />Rol: {inv.role}</p>
                  {inv.status === 'pendiente' && !isExpired && (
                    <p className="info-card__countdown">
                      <Icon name="icon-clock" size={13} />
                      <span>{remainingMin > 0 ? `Expira en ${remainingMin} min` : 'Expirado'}</span>
                    </p>
                  )}
                  <p className="info-card__url">{buildInviteLink(inv.invitePath)}</p>
                  <div className="info-card__actions">
                    {inv.status === 'pendiente' && !isExpired && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => void copyInviteLink(inv.invitePath)}>
                        <Icon name="icon-copy" size={14} /> Copiar link
                      </Button>
                    )}
                  </div>
                </div>
              )
            }) : (
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
                {currentUser?.role === 'admin' && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => {
                    setEditingPosition(pos)
                    setPositionPermissions(pos.permissions?.length ? pos.permissions : ['dashboard', 'turnos-fijos'])
                    setActiveModal('position')
                  }}>
                    <Icon name="icon-edit" size={14} /> Configurar
                  </Button>
                )}
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
                        {currentUser?.role === 'admin' && (
                          <>
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
                          </>
                        )}
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
            <p>Define que modulos puede ver este cargo. Clasificados por nivel de responsabilidad.</p>
          </div>
          {(companyType === 'empresa' ? empresaPermissionGroups : academiaPermissionGroups).map((group) => (
            <div className="access-picker__group" key={group.title}>
              <div className="access-picker__group-header">
                <div className="access-picker__group-title">
                  <strong>{group.title}</strong>
                  <span className="access-picker__tag">{group.tag}</span>
                </div>
                <span className="access-picker__group-desc">{group.description}</span>
              </div>
              <div className="access-picker__grid">
                {group.modules.map((mod) => (
                  <button key={mod} type="button"
                    className={`access-picker__item${positionPermissions.includes(mod) ? ' access-picker__item--on' : ''}`}
                    onClick={() => togglePermission(mod)}>
                    <strong>{accessModuleLabels[mod]}</strong>
                    <span>{accessModuleDescriptions[mod]}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
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

      {/* Modal: Detalle del empleado — turnos con fotos */}
      <Modal
        open={!!detailWorkerId}
        title={`Detalle: ${workers.find((w) => w.id === detailWorkerId)?.nombreCompleto ?? ''}`}
        description="Historial de turnos y fotos de ingreso."
        onClose={() => setDetailWorkerId(null)}
      >
        {detailWorkerId && (() => {
          const worker = workers.find((w) => w.id === detailWorkerId)
          const workerTurns = turns
            .filter((t) => t.assignedToUserId === detailWorkerId)
            .sort((a, b) => b.fecha.localeCompare(a.fecha))
            .slice(0, 20)

          return (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {/* Info personal */}
              <div className="personal-info-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <div className="personal-info-item">
                  <span className="personal-info-label">Documento</span>
                  <strong>{worker?.numeroDocumento ?? '—'}</strong>
                </div>
                <div className="personal-info-item">
                  <span className="personal-info-label">Cargo</span>
                  <strong>{worker?.cargo ?? '—'}</strong>
                </div>
                <div className="personal-info-item">
                  <span className="personal-info-label">Correo</span>
                  <strong>{worker?.correo ?? '—'}</strong>
                </div>
                <div className="personal-info-item">
                  <span className="personal-info-label">Teléfono</span>
                  <strong>{worker?.telefono ?? '—'}</strong>
                </div>
                <div className="personal-info-item">
                  <span className="personal-info-label">Rol</span>
                  <strong className="personal-info-role">{worker?.role}</strong>
                </div>
                <div className="personal-info-item">
                  <span className="personal-info-label">Turnos registrados</span>
                  <strong>{workerTurns.length}</strong>
                </div>
              </div>

              {/* Turnos con fotos */}
              <h4 style={{ margin: 0 }}>Últimos turnos</h4>
              {workerTurns.length ? (
                <div style={{ display: 'grid', gap: '.6rem', maxHeight: 400, overflow: 'auto' }}>
                  {workerTurns.map((t) => (
                    <div key={t.id} className="worker-detail-turn">
                      <div className="worker-detail-turn__info">
                        <strong>{t.fecha}</strong>
                        <span>{t.hora}{t.horaFin ? ` – ${t.horaFin}` : ''} · {t.locationNombre ?? 'Sin ubicación'}</span>
                        <span className={`status-badge status-badge--${t.estado}`}>{t.estado.replace('_', ' ')}</span>
                      </div>
                      <div className="worker-detail-turn__photos">
                        {t.attendance?.checkIn?.facialPhotoUrl && (
                          <a href={t.attendance.checkIn.facialPhotoUrl} target="_blank" rel="noopener noreferrer" className="worker-detail-photo">
                            <img src={t.attendance.checkIn.facialPhotoUrl} alt="Foto entrada" />
                            <span>Entrada · {new Date(t.attendance.checkIn.markedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                          </a>
                        )}
                        {t.attendance?.checkOut?.facialPhotoUrl && (
                          <a href={t.attendance.checkOut.facialPhotoUrl} target="_blank" rel="noopener noreferrer" className="worker-detail-photo">
                            <img src={t.attendance.checkOut.facialPhotoUrl} alt="Foto salida" />
                            <span>Salida · {new Date(t.attendance.checkOut.markedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                          </a>
                        )}
                        {!t.attendance?.checkIn?.facialPhotoUrl && !t.attendance?.checkOut?.facialPhotoUrl && (
                          <span style={{ fontSize: 12, color: 'var(--clr-text-2)' }}>Sin fotos registradas</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ textAlign: 'center', color: 'var(--clr-text-2)' }}>Sin turnos registrados.</p>
              )}
            </div>
          )
        })()}
      </Modal>

      {/* Modal: Historial de horas */}
      <Modal
        open={hoursModalOpen}
        title="Historial de horas trabajadas"
        description="Detalle de horas por empleado con desglose de recargos."
        onClose={() => { setHoursModalOpen(false); setHoursData(null) }}
      >
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="att-filter" style={{ flex: 1, minWidth: 140 }}>
              <span>Rango</span>
              <select value={hoursRange} onChange={(e) => { const v = e.target.value as '15' | '30'; setHoursRange(v); void loadHoursHistory(v, hoursFilterUser || undefined) }}>
                <option value="15">Últimos 15 días</option>
                <option value="30">Últimos 30 días</option>
              </select>
            </label>
            <label className="att-filter" style={{ flex: 1, minWidth: 140 }}>
              <span>Empleado</span>
              <select value={hoursFilterUser} onChange={(e) => { const v = e.target.value; setHoursFilterUser(v); void loadHoursHistory(hoursRange, v || undefined) }}>
                <option value="">Todos</option>
                {workers.map((w) => <option key={w.id} value={w.id}>{w.nombreCompleto}</option>)}
              </select>
            </label>
          </div>

          {hoursLoading ? (
            <p style={{ textAlign: 'center', padding: '1rem', color: 'var(--clr-text-2)' }}>Cargando...</p>
          ) : hoursData ? (
            <>
              {/* Resumen */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.5rem' }}>
                <div className="signal-chip"><strong>{hoursData.summary.totalHoras}</strong><span>Horas totales</span></div>
                <div className="signal-chip"><strong>{hoursData.summary.totalOrdinarias}</strong><span>Ordinarias</span></div>
                <div className="signal-chip"><strong>{hoursData.summary.totalDominicales}</strong><span>Dominicales</span></div>
                <div className="signal-chip"><strong>{hoursData.summary.totalFestivas}</strong><span>Festivas</span></div>
              </div>

              {/* Tabla */}
              {hoursData.records.length > 0 ? (
                <div className="table-wrap" style={{ maxHeight: 350, overflow: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Empleado</th>
                        <th>Fecha</th>
                        <th>Entrada</th>
                        <th>Salida</th>
                        <th>Horas</th>
                        <th>Tipo</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hoursData.records.map((r: any) => (
                        <tr key={r.id}>
                          <td><strong>{r.nombreUsuario}</strong></td>
                          <td>{r.fecha}</td>
                          <td>{r.horaEntradaReal ?? '—'}</td>
                          <td>{r.horaSalidaReal ?? '—'}</td>
                          <td><span className="hours-badge">{r.horasTrabajadas?.toFixed(1) ?? '0'}h</span></td>
                          <td>
                            {r.esFestivo ? <span style={{ color: '#dc2626', fontWeight: 500, fontSize: 12 }}>Festivo</span>
                              : r.esDominical ? <span style={{ color: '#d97706', fontWeight: 500, fontSize: 12 }}>Dominical</span>
                              : <span style={{ color: 'var(--clr-text-2)', fontSize: 12 }}>Ordinaria</span>}
                          </td>
                          <td><span className={`status-badge status-badge--${r.estadoTurno}`}>{r.estadoTurno}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ textAlign: 'center', padding: '1rem', color: 'var(--clr-text-2)' }}>Sin registros de horas en este periodo.</p>
              )}
            </>
          ) : null}
        </div>
      </Modal>

      {/* Modal: Editar empleado */}
      <Modal
        open={activeModal === 'worker-edit'}
        title={`Editar: ${editingWorker?.nombreCompleto ?? ''}`}
        onClose={() => { setEditingWorker(null); setActiveModal(null) }}
      >
        {editingWorker && (
          <CustomForm
            key={editingWorker.id}
            title=""
            fields={[
              { name: 'nombreCompleto', label: 'Nombre completo', defaultValue: editingWorker.nombreCompleto, required: true },
              { name: 'correo', label: 'Correo', defaultValue: editingWorker.correo, required: true },
              { name: 'telefono', label: 'Teléfono', defaultValue: editingWorker.telefono ?? '' },
              { name: 'cargo', label: 'Cargo', defaultValue: editingWorker.cargo },
              { name: 'positionId', label: 'Cargo (puesto)', type: 'select', defaultValue: editingWorker.positionId ?? '',
                options: positions.map((p) => ({ label: p.nombre, value: p.id })) },
            ]}
            submitLabel="Guardar cambios"
            showReset={false}
            onSubmit={(v) => void handleEditWorker(v as Record<string, string>)}
          />
        )}
      </Modal>

      {/* Modal: Confirmar eliminación de empleado */}
      <Modal
        open={activeModal === 'worker-delete'}
        title="Eliminar empleado"
        description={`¿Seguro que deseas eliminar a "${deletingWorker?.nombreCompleto ?? ''}"? Esta acción no se puede deshacer.`}
        onClose={() => { setDeletingWorker(null); setActiveModal(null) }}
      >
        <div className="confirm-actions">
          <Button type="button" variant="ghost" onClick={() => { setDeletingWorker(null); setActiveModal(null) }}>Cancelar</Button>
          <Button type="button" variant="primary" className="btn-danger" onClick={() => void handleDeleteWorker()}>
            <Icon name="icon-x-circle" size={16} /> Eliminar empleado
          </Button>
        </div>
      </Modal>

      {/* Modal: Editar turno */}
      <Modal
        open={activeModal === 'turn-edit'}
        title={`Editar turno: ${editingTurnData?.turn.titulo ?? ''}`}
        description="Modifica fecha, horario o ubicacion del turno."
        onClose={() => { setEditingTurnData(null); setActiveModal(null) }}
      >
        {editingTurnData && (
          <div className="turn-form">
            <div className="turn-form__fields">
              <label className="turn-form__field">
                <span>Fecha</span>
                <input type="date" value={editingTurnData.fecha}
                  onChange={(e) => setEditingTurnData({ ...editingTurnData, fecha: e.target.value })} />
              </label>
              <label className="turn-form__field">
                <span>Hora inicio</span>
                <input type="time" value={editingTurnData.hora}
                  onChange={(e) => setEditingTurnData({ ...editingTurnData, hora: e.target.value })} />
              </label>
              <label className="turn-form__field">
                <span>Hora fin</span>
                <input type="time" value={editingTurnData.horaFin}
                  onChange={(e) => setEditingTurnData({ ...editingTurnData, horaFin: e.target.value })} />
              </label>
              <label className="turn-form__field turn-form__field--full">
                <span>Ubicacion</span>
                <select value={editingTurnData.locationId}
                  onChange={(e) => setEditingTurnData({ ...editingTurnData, locationId: e.target.value })}>
                  <option value="">Sin ubicacion</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.nombre}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="confirm-actions" style={{ marginTop: '1rem' }}>
              <Button type="button" variant="ghost" onClick={() => { setEditingTurnData(null); setActiveModal(null) }}>Cancelar</Button>
              <Button type="button" variant="primary" onClick={() => void handleUpdateTurnDetails()}>
                <Icon name="icon-check" size={16} /> Guardar cambios
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
