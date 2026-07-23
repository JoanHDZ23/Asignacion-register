export type AccessModule =
  | 'dashboard'
  | 'turnos-fijos'
  | 'turnos-rotativos'
  | 'horas-extras-recargos'
  | 'geolocalizacion'
  | 'permisos-ausencias'
  | 'biometria-facial'
  | 'teletrabajo'
  | 'facturacion'
  | 'informes'
  | 'configuracion'
  | 'asistencia-clase'
  | 'codigo-qr'
  | 'asistencia-docente'
  | 'porcentaje-asistencia'
  | 'justificaciones'
  | 'alertas-inasistencia'
  | 'eventos-talleres'

export const allAccessModules: AccessModule[] = [
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

export function getDefaultAllowedModules(role: 'admin' | 'supervisor' | 'operativo') {
  if (role === 'admin') return allAccessModules
  if (role === 'supervisor') return ['dashboard', 'turnos-fijos', 'geolocalizacion', 'informes'] as AccessModule[]
  return ['dashboard', 'turnos-fijos'] as AccessModule[]
}
