import type { AccessModule, CompanySettings, CompanyType, DatabaseSchema, User } from '../types.js'

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

  // Empresa
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

export function resolveAllowedModules(db: DatabaseSchema, user: User): AccessModule[] {
  const company = db.companies.find((c) => c.id === user.companyId)
  const companyModules = company?.enabledModules ?? empresaModules

  if (user.role === 'admin') {
    return companyModules
  }

  if (user.role === 'supervisor' || user.role === 'docente') {
    // Supervisores y docentes ven módulos operativos sin configuración
    return companyModules.filter((m) => m !== 'configuracion')
  }

  // Operativo / estudiante — permisos definidos por su cargo
  const position = user.positionId
    ? db.positions.find((item) => item.id === user.positionId && item.companyId === user.companyId)
    : undefined

  if (position?.permissions?.length) {
    return position.permissions
  }

  // Defaults mínimos
  return ['dashboard'] satisfies AccessModule[]
}
