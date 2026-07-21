export type UserRole = 'admin' | 'supervisor' | 'operativo'
export type TurnStatus = 'pendiente' | 'asignado' | 'en_proceso' | 'finalizado' | 'confirmado' | 'rechazado'
export type InvitationStatus = 'pendiente' | 'completada' | 'cancelada'
export type AccessModule = 'dashboard' | 'asignacion-turnos' | 'gestion-asistencia'
export type AttendanceAction = 'entrada' | 'salida'

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
  method: 'webauthn' | 'pin'
  credentialId: string
  locationCheck: AttendanceLocationCheck
  facialPhotoUrl?: string
}

export type TurnAttendance = {
  checkIn?: AttendanceRecord
  checkOut?: AttendanceRecord
}

export type Company = {
  id: string
  nombre: string
  nit: string
  correo: string
  telefono?: string
  direccion?: string
  ciudad?: string
  createdAt: string
}

export type Position = {
  id: string
  companyId: string
  nombre: string
  descripcion?: string
  permissions: AccessModule[]
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
  confirmedDeadline?: string   // ISO — 4h antes de la hora del turno, límite para confirmar
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
}

export type AuthUser = {
  userId: string
  companyId: string
  role: UserRole
}
