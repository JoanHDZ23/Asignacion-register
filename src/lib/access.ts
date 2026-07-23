import type { AccessModule, CompanySettings, CompanyType, DatabaseSchema, User } from '../types.js'

export const empresaModules: AccessModule[] = [
  'dashboard',
  'asignacion-turnos',
  'gestion-asistencia',
  'facturacion',
  'informes',
  'configuracion',
]

export const academiaModules: AccessModule[] = [
  'dashboard',
  'horarios',
  'asistencia-clases',
  'calificaciones',
  'informes',
  'configuracion',
]

export function getDefaultModulesByType(tipo: CompanyType): AccessModule[] {
  return tipo === 'academia' ? academiaModules : empresaModules
}

export function getDefaultSettings(tipo: CompanyType): CompanySettings {
  return {
    requireBiometric: tipo === 'empresa',
    requirePhoto: true,
    requireLocationValidation: true,
    allowAutoCloseMinutes: 30,
    defaultConfirmHoursLimit: 4,
    timezone: 'America/Bogota',
  }
}

export function resolveCompanyIdForUser(db: DatabaseSchema, user: User | undefined) {
  if (!user) {
    return ''
  }

  return user.companyId || db.users.find((item) => item.id === user.id)?.companyId || ''
}

export function resolveAllowedModules(db: DatabaseSchema, user: User) {
  if (user.role === 'admin') {
    // Admin ve los módulos habilitados de su empresa
    const company = db.companies.find((c) => c.id === user.companyId)
    return company?.enabledModules?.length ? company.enabledModules : empresaModules
  }

  if (user.role === 'supervisor') {
    return ['dashboard', 'asignacion-turnos', 'gestion-asistencia'] satisfies AccessModule[]
  }

  const position = user.positionId
    ? db.positions.find((item) => item.id === user.positionId && item.companyId === user.companyId)
    : undefined

  if (position?.permissions?.length) {
    return position.permissions
  }

  return ['dashboard', 'asignacion-turnos'] satisfies AccessModule[]
}
