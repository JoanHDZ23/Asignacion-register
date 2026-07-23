export type UserRole = 'admin' | 'supervisor' | 'operativo' | 'docente' | 'estudiante'
export type TurnStatus = 'pendiente' | 'asignado' | 'en_proceso' | 'finalizado' | 'confirmado' | 'rechazado'
export type InvitationStatus = 'pendiente' | 'completada' | 'cancelada'
export type AttendanceAction = 'entrada' | 'salida'
export type CompanyType = 'empresa' | 'academia'

// ── Módulos por tipo de gestión ──────────────────────────────────────────────

// Módulos disponibles para tipo EMPRESA
export type EmpresaModule =
  | 'dashboard'
  | 'turnos-fijos'              // Turnos con horario rígido
  | 'turnos-rotativos'         // Asignación dinámica mañana/tarde/noche
  | 'horas-extras-recargos'    // Dominicales, festivos, nocturno
  | 'geolocalizacion'          // Geofencing por punto operativo
  | 'permisos-ausencias'       // Licencias, vacaciones, incapacidades
  | 'biometria-facial'         // WebAuthn / foto facial
  | 'teletrabajo'              // Fichaje remoto
  | 'facturacion'              // Cuenta de cobro y liquidación
  | 'informes'                 // Reportes y exportación
  | 'configuracion'            // Gestión de cargos, ubicaciones

// Módulos disponibles para tipo ACADEMIA
export type AcademiaModule =
  | 'dashboard'
  | 'asistencia-clase'         // Pase de lista por asignatura
  | 'codigo-qr'               // QR dinámico para confirmar presencia
  | 'asistencia-docente'       // Horas cátedra cumplidas
  | 'porcentaje-asistencia'    // Control de faltas / pérdida de materia
  | 'justificaciones'          // Excusas médicas o institucionales
  | 'alertas-inasistencia'     // Notificaciones por faltas consecutivas
  | 'eventos-talleres'         // Actividades extracurriculares
  | 'informes'                 // Reportes y exportación
  | 'configuracion'            // Gestión de materias, horarios

export type AccessModule = EmpresaModule | AcademiaModule

export type StoredWebAuthnCredential = {
  id: string
  publicKey: number[]
  counter: number
  transports?: string[]
  createdAt: string
  lastUsedAt?: string
}

export type UserBiometricProfile = {
  credentials: StoredWebAuthnCredential[]
  registrationChallenge?: string
  authenticationChallenge?: string
  pendingRpId?: string
  pendingTurnId?: string
  pendingAttendanceAction?: AttendanceAction
}

export type AttendanceLocationCheck = {
  latitude: number
  longitude: number
  distanceMeters: number
  allowedRadiusMeters: number
  withinRange: boolean
  locationId: string
  locationNombre?: string
  verifiedAt: string
}

export type AttendanceRecord = {
  action: AttendanceAction
  markedAt: string
  method: 'webauthn' | 'pin' | 'auto'
  credentialId: string
  locationCheck: AttendanceLocationCheck
  facialPhotoUrl?: string
}

export type TurnAttendance = {
  checkIn?: AttendanceRecord
  checkOut?: AttendanceRecord
}

export type CompanySettings = {
  // ── Comunes ──────────────────────────────────────────────
  requireBiometric: boolean
  requirePhoto: boolean
  requireLocationValidation: boolean
  allowAutoCloseMinutes: number
  defaultConfirmHoursLimit: number
  timezone: string

  // ── Empresa ──────────────────────────────────────────────
  billingRateDefault?: number          // Tarifa hora por defecto
  recargoNocturno?: number             // % recargo nocturno (default 35)
  recargoDominical?: number            // % recargo dominical (default 75)
  recargoFestivo?: number              // % recargo festivo (default 100)
  jornadaOrdinaria?: number            // Horas jornada ordinaria (default 8)
  permitirTeletrabajo?: boolean        // Habilita fichaje remoto
  permitirPermutaTurnos?: boolean      // Permite cambio de turnos entre empleados

  // ── Academia ─────────────────────────────────────────────
  maxInasistenciaPorcentaje?: number   // % máximo de faltas antes de perder materia (default 20)
  duracionBloque?: number              // Minutos por bloque académico (default 45)
  alertaFaltasConsecutivas?: number    // Nº de faltas para activar alerta (default 3)
  requiereExcusaFormal?: boolean       // Exige documento de excusa para justificar
  habilitarQrDinamico?: boolean        // QR cambiante por clase
}

export type Company = {
  id: string
  nombre: string
  nit: string
  correo: string
  telefono?: string
  direccion?: string
  ciudad?: string
  tipo: CompanyType
  enabledModules: AccessModule[]
  settings: CompanySettings
  createdAt: string
}

export type Position = {
  id: string
  companyId: string
  nombre: string
  descripcion?: string
  permissions: AccessModule[]
  valorHora?: number
  activa: boolean
  createdAt: string
}

export type Location = {
  id: string
  companyId: string
  nombre: string
  direccion?: string
  latitud?: string
  longitud?: string
  radioTolerancia?: string
  descripcion?: string
  createdAt: string
}

export type User = {
  id: string
  companyId: string
  nombreCompleto: string
  tipoDocumento: string
  numeroDocumento: string
  correo: string
  telefono?: string
  cargo: string
  role: UserRole
  positionId?: string
  activa: boolean
  biometric?: UserBiometricProfile
  createdAt: string
}

export type Turn = {
  id: string
  companyId: string
  titulo: string
  descripcion?: string
  fecha: string
  hora: string
  horaFin?: string
  estado: TurnStatus
  creadoPorUserId: string
  assignedToUserId?: string
  assignedToUserName?: string
  locationId?: string
  locationNombre?: string
  confirmedDeadline?: string
  confirmHoursLimit?: number          // Horas antes del turno para confirmar (default 4)
  rejectionReason?: string
  attendance?: TurnAttendance
  createdAt: string
  updatedAt: string
}

export type UserInvitation = {
  id: string
  token: string
  companyId: string
  positionId: string
  cargo: string
  role: UserRole
  status: InvitationStatus
  invitedByUserId: string
  invitedUserId?: string
  createdAt: string
  completedAt?: string
}

export type DatabaseSchema = {
  companies: Company[]
  users: User[]
  positions: Position[]
  locations: Location[]
  turns: Turn[]
  userInvitations: UserInvitation[]
  horasTurno: HorasTurnoRecord[]
  facturas: Factura[]
}

export type HorasTurnoRecord = {
  id: string
  companyId: string
  facturaId?: string
  turnId: string
  userId: string
  nombreUsuario: string
  cargo: string
  locationId?: string
  nombreUbicacion?: string
  fecha: string
  diaSemana: string                    // 'lunes' | 'martes' | ... | 'domingo'
  esDominical: boolean                 // true si es domingo
  esFestivo: boolean                   // true si es día festivo
  horaEntradaEsperada: string
  horaSalidaEsperada?: string
  horaEntradaReal?: string
  horaSalidaReal?: string
  horasTrabajadas: number              // Total horas del turno
  horasOrdinarias: number              // Horas en día laboral normal
  horasDominicales: number             // Horas en domingo
  horasFestivas: number                // Horas en festivo
  metodoSalida?: 'webauthn' | 'pin' | 'auto'
  valorHora?: number                   // Tarifa hora ordinaria
  recargoDominical?: number            // % recargo dominical (default 75%)
  recargoFestivo?: number              // % recargo festivo (default 100%)
  subtotalOrdinario?: number           // horasOrdinarias × valorHora
  subtotalDominical?: number           // horasDominicales × valorHora × (1 + recargoDominical/100)
  subtotalFestivo?: number             // horasFestivas × valorHora × (1 + recargoFestivo/100)
  subtotal?: number                    // Suma de los tres subtotales
  estadoTurno: string
  confirmadoPor?: string
  createdAt: string
}

export type FacturaEstado = 'borrador' | 'emitida' | 'pagada' | 'anulada'

export type Factura = {
  id: string
  companyId: string
  periodoMes: string
  fechaGeneracion: string
  totalHoras: number
  totalHorasOrdinarias: number
  totalHorasDominicales: number
  totalHorasFestivas: number
  totalValorOrdinario: number
  totalValorDominicales: number
  totalValorFestivos: number
  totalValor: number
  moneda: string
  recargoDominical: number             // % aplicado (default 75)
  recargoFestivo: number               // % aplicado (default 100)
  estado: FacturaEstado
  observaciones?: string
  generadoPor: string
  createdAt: string
}

export type AuthUser = {
  userId: string
  companyId: string
  role: UserRole
}
