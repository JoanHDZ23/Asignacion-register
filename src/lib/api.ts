import type { AccessModule } from './access'

export const API_BASE_URL = 'https://asignacion-register.onrender.com/api'
export const API_DOCS_URL = 'https://asignacion-register.onrender.com/api-docs/'

type ApiOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  token?: string
  body?: unknown
}

/** Dispara un evento global cuando el servidor devuelve 401.
 *  El DashboardLayout lo escucha y redirige al login. */
function dispatchSessionExpired() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ommex:session-expired'))
  }
}

export type LoginResponse = {
  token: string
  user: {
    id: string
    companyId: string
    nombreCompleto: string
    correo: string
    cargo: string
    role: 'admin' | 'supervisor' | 'operativo'
    positionId?: string
    allowedModules: AccessModule[]
  }
}

export type CompanyResponse = {
  id: string
  nombre: string
  nit: string
  correo: string
  telefono?: string
  direccion?: string
  ciudad?: string
  tipo?: 'empresa' | 'academia'
  enabledModules?: AccessModule[]
  createdAt: string
}

export type CompanySummaryResponse = {
  empresa?: CompanyResponse
  totalUsuarios: number
  totalPuestos: number
  totalTurnos: number
}

export type CompanyManagementResponse = {
  company: CompanyResponse | null
  currentUser: {
    id: string
    companyId: string
    role: 'admin' | 'supervisor' | 'operativo'
    positionId?: string
    allowedModules: AccessModule[]
  } | null
  summary: {
    totalUsuarios: number
    totalPuestos: number
    totalUbicaciones: number
    totalInvitaciones: number
    totalTurnos: number
  }
  positions: PositionResponse[]
  users: UserResponse[]
  locations: LocationResponse[]
  invitations: UserInvitationResponse[]
  turns: TurnResponse[]
}

export type PositionResponse = {
  id: string
  companyId: string
  nombre: string
  descripcion?: string
  permissions: AccessModule[]
  valorHora?: number
  activa: boolean
  createdAt: string
}

export type LocationResponse = {
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

export type UserResponse = {
  id: string
  companyId: string
  nombreCompleto: string
  tipoDocumento: string
  numeroDocumento: string
  correo: string
  telefono?: string
  cargo: string
  role: 'admin' | 'supervisor' | 'operativo'
  positionId?: string
  activa: boolean
  createdAt: string
}

export type UserInvitationResponse = {
  id: string
  token: string
  companyId: string
  positionId: string
  cargo: string
  role: 'admin' | 'operativo'
  status: 'pendiente' | 'completada' | 'cancelada'
  invitedByUserId: string
  invitedUserId?: string
  createdAt: string
  completedAt?: string
  invitePath: string
}

export type UserInvitationDetailResponse = {
  token: string
  company: {
    id: string
    nombre: string
  } | null
  position: {
    id: string
    nombre: string
  } | null
  cargo: string
  role: 'admin' | 'operativo'
  status: 'pendiente' | 'completada' | 'cancelada'
}

export type TurnResponse = {
  id: string
  companyId: string
  titulo: string
  descripcion?: string
  fecha: string
  hora: string
  horaFin?: string
  estado: 'pendiente' | 'asignado' | 'en_proceso' | 'finalizado' | 'confirmado' | 'rechazado'
  creadoPorUserId: string
  assignedToUserId?: string
  assignedToUserName?: string
  locationId?: string
  locationNombre?: string
  confirmedDeadline?: string
  confirmHoursLimit?: number
  rejectionReason?: string
  attendance?: {
    checkIn?: {
      action: 'entrada'
      markedAt: string
      method: 'webauthn' | 'pin'
      credentialId: string
      facialPhotoUrl?: string
      locationCheck: {
        latitude: number
        longitude: number
        distanceMeters: number
        allowedRadiusMeters: number
        withinRange: boolean
        locationId: string
        locationNombre?: string
        verifiedAt: string
      }
    }
    checkOut?: {
      action: 'salida'
      markedAt: string
      method: 'webauthn' | 'pin'
      credentialId: string
      facialPhotoUrl?: string
      locationCheck: {
        latitude: number
        longitude: number
        distanceMeters: number
        allowedRadiusMeters: number
        withinRange: boolean
        locationId: string
        locationNombre?: string
        verifiedAt: string
      }
    }
  }
  createdAt: string
  updatedAt: string
}

export type BiometricStatusResponse = {
  biometricConfigured: boolean
  credentialCount: number
}

export type VerifyBiometricRegistrationResponse = {
  verified: boolean
  biometricConfigured: boolean
  credentialCount: number
}

export type VerifyAttendanceResponse = {
  verified: boolean
  action: 'entrada' | 'salida'
  turn: TurnResponse
  attendance: NonNullable<TurnResponse['attendance']>['checkIn'] | NonNullable<TurnResponse['attendance']>['checkOut']
}

type ApiErrorPayload = {
  message?: string
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    let message = 'No fue posible completar la solicitud.'

    try {
      const errorPayload = (await response.json()) as ApiErrorPayload
      if (errorPayload.message) {
        message = errorPayload.message
      }
    } catch {
      message = response.statusText || message
    }

    // Token expirado o inválido — limpia sesión y notifica al layout
    if (response.status === 401) {
      dispatchSessionExpired()
    }

    throw new Error(message)
  }

  if (response.status === 204) {
    return null as T
  }

  return (await response.json()) as T
}
