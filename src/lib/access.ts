import type { AccessModule, CompanySettings, CompanyType, DatabaseSchema, User } from '../types.js'
import { defaultPermissionsByRole } from '../types.js'

// ── Módulos por defecto según tipo de gestión ──────────────────────────

export const empresaModules: AccessModule[] = [
  'dashboard',
  'turnos-fijos',
  'turnos-rotativos',
  'horas-extras-recargos',
  'geolocalizacion',
  'permisos-ausencias',
  'biometria-facial',
  'facturacion',
  'informes',
  'configuracion',
]

export const academiaModules: AccessModule[] = [
  'dashboard',
  'asistencia-clase',
  'codigo-qr',
  'asistencia-docente',
  'porcentaje-asistencia',
  'justificaciones',
  'alertas-inasistencia',
  'eventos-talleres',
  'informes',
  'configuracion',
]

export function getDefaultModulesByType(tipo: CompanyType): AccessModule[] {
  return tipo === 'academia' ? academiaModules : empresaModules
}

export function getDefaultSettings(tipo: CompanyType): CompanySettings {
  const base = {
    requireBiometric: true,
    requirePhoto: true,
    requireLocationValidation: true,
    allowAutoCloseMinutes: 30,
    defaultConfirmHoursLimit: 4,
    timezone: 'America/Bogota',
  }

  if (tipo === 'academia') {
    return {
      ...base,
      requireBiometric: false,
      requireLocationValidation: false,
      maxInasistenciaPorcentaje: 20,
      duracionBloque: 45,
      alertaFaltasConsecutivas: 3,
      requiereExcusaFormal: true,
      habilitarQrDinamico: true,
    }
  }

  return {
    ...base,
    billingRateDefault: undefined,
    recargoNocturno: 35,
    recargoDominical: 75,
    recargoFestivo: 100,
    jornadaOrdinaria: 8,
    permitirTeletrabajo: false,
    permitirPermutaTurnos: false,
  }
}

export function resolveCompanyIdForUser(db: DatabaseSchema, user: User | undefined) {
  if (!user) return ''
  return user.companyId || db.users.find((item) => item.id === user.id)?.companyId || ''
}

/**
 * Resuelve los módulos permitidos para un usuario según:
 * 1. Tipo de empresa (empresa vs academia)
 * 2. Rol del usuario (admin, supervisor, operativo, docente, estudiante)
 * 3. Permisos específicos del cargo (Position) si están definidos
 */
export function resolveAllowedModules(db: DatabaseSchema, user: User): AccessModule[] {
  const company = db.companies.find((c) => c.id === user.companyId)
  const companyType = company?.tipo ?? 'empresa'
  const companyModules = company?.enabledModules ?? getDefaultModulesByType(companyType)

  // Admin: todos los módulos habilitados de la empresa
  if (user.role === 'admin') {
    return companyModules
  }

  // Permisos específicos del cargo (si están definidos)
  const position = user.positionId
    ? db.positions.find((item) => item.id === user.positionId && item.companyId === user.companyId)
    : undefined

  if (position?.permissions?.length) {
    // Intersección: solo permisos del cargo que la empresa tiene habilitados
    return position.permissions.filter((m) => companyModules.includes(m))
  }

  // Permisos por defecto del rol según tipo de empresa
  const roleDefaults = defaultPermissionsByRole[user.role]
  const defaults = companyType === 'academia' ? roleDefaults.academia : roleDefaults.empresa

  // Intersección con módulos habilitados de la empresa
  return defaults.filter((m) => companyModules.includes(m))
}

/**
 * Resuelve los niveles de permiso (view/edit) para cada módulo del usuario.
 * Admin siempre tiene 'edit' en todo. Los demás dependen del cargo.
 */
export function resolvePermissionLevels(db: DatabaseSchema, user: User): Record<string, 'view' | 'edit'> {
  const modules = resolveAllowedModules(db, user)
  const levels: Record<string, 'view' | 'edit'> = {}

  // Admin: siempre edit en todo
  if (user.role === 'admin') {
    for (const m of modules) levels[m] = 'edit'
    return levels
  }

  // Si el cargo tiene permissionLevels definidos, usarlos
  const position = user.positionId
    ? db.positions.find((item) => item.id === user.positionId && item.companyId === user.companyId)
    : undefined

  for (const m of modules) {
    if (position?.permissionLevels?.[m]) {
      levels[m] = position.permissionLevels[m]
    } else {
      // Por defecto: supervisor puede editar turnos e informes, operativo solo ve
      const isSup = user.role === 'supervisor' || user.cargo?.toLowerCase().includes('supervisor')
      levels[m] = isSup ? 'edit' : 'view'
    }
  }

  return levels
}
