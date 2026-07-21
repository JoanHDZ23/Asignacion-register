export type AccessModule = 'dashboard' | 'asignacion-turnos' | 'gestion-asistencia'

export const allAccessModules: AccessModule[] = [
  'dashboard',
  'asignacion-turnos',
  'gestion-asistencia',
]

export function getDefaultAllowedModules(role: 'admin' | 'supervisor' | 'operativo') {
  if (role === 'admin') return allAccessModules
  return ['dashboard', 'asignacion-turnos'] as AccessModule[]
}
