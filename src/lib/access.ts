import type { AccessModule, DatabaseSchema, User } from '../types.js'

export const allAccessModules: AccessModule[] = [
  'dashboard',
  'asignacion-turnos',
  'gestion-asistencia',
]

export function resolveCompanyIdForUser(db: DatabaseSchema, user: User | undefined) {
  if (!user) {
    return ''
  }

  return user.companyId || db.users.find((item) => item.id === user.id)?.companyId || ''
}

export function resolveAllowedModules(db: DatabaseSchema, user: User) {
  if (user.role === 'admin') {
    return allAccessModules
  }

  // Supervisor: acceso a dashboard y asignacion de turnos (solo lectura + confirmar)
  if (user.role === 'supervisor') {
    return ['dashboard', 'asignacion-turnos'] satisfies AccessModule[]
  }

  const position = user.positionId
    ? db.positions.find((item) => item.id === user.positionId && item.companyId === user.companyId)
    : undefined

  if (position?.permissions?.length) {
    return position.permissions
  }

  return ['dashboard', 'asignacion-turnos'] satisfies AccessModule[]
}
