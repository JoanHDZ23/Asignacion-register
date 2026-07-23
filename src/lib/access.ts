export type AccessModule = 'dashboard' | 'asignacion-turnos' | 'gestion-asistencia' | 'horarios' | 'asistencia-clases' | 'calificaciones' | 'informes' | 'facturacion' | 'configuracion'

export const allAccessModules: AccessModule[] = [
  'dashboard',
  'asignacion-turnos',
  'gestion-asistencia',
  'informes',
  'facturacion',
  'configuracion',
]

export function getDefaultAllowedModules(role: 'admin' | 'supervisor' | 'operativo') {
  if (role === 'admin') return allAccessModules
  if (role === 'supervisor') return ['dashboard', 'asignacion-turnos', 'gestion-asistencia'] as AccessModule[]
  return ['dashboard', 'asignacion-turnos'] as AccessModule[]
}
