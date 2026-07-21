import { Router } from 'express'
import { resolveCompanyIdForUser } from '../lib/access.js'
import { createTurn, deleteTurn, readDatabase, updateTurn } from '../lib/database.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import type { TurnStatus } from '../types.js'

export const turnsRouter = Router()

/** Calcula el deadline de confirmación: hora del turno - 4 horas. */
function buildConfirmedDeadline(fecha: string, hora: string): string {
  const turnStart = new Date(`${fecha}T${hora}:00`)
  const deadline = new Date(turnStart.getTime() - 4 * 60 * 60 * 1000)
  return deadline.toISOString()
}

turnsRouter.use(requireAuth)

turnsRouter.get('/', async (request, response) => {
  const db = await readDatabase()
  const { fecha, estado, assignedToUserId, locationId } = request.query
  const currentUser = db.users.find((item) => item.id === request.authUser!.userId)
  const companyId = resolveCompanyIdForUser(db, currentUser)
  const role = request.authUser!.role
  const userId = request.authUser!.userId

  // Detecta supervisor por rol exacto O por cargo que contenga "supervisor"
  const isSupervisor = role === 'supervisor'
    || (role !== 'admin' && currentUser?.cargo?.toLowerCase().includes('supervisor'))

  const turns = db.turns.filter((turn) => {
    if (turn.companyId !== companyId) return false

    // Operativo puro (sin cargo supervisor): solo sus propios turnos
    if (!isSupervisor && role === 'operativo' && turn.assignedToUserId !== userId) return false

    // Supervisor y admin: ven todos los turnos de la empresa
    // (el frontend filtra lo que muestra según el contexto)

    if (typeof fecha === 'string' && fecha && turn.fecha !== fecha) return false
    if (typeof estado === 'string' && estado && turn.estado !== estado) return false
    if (typeof assignedToUserId === 'string' && assignedToUserId && turn.assignedToUserId !== assignedToUserId) return false
    if (typeof locationId === 'string' && locationId && turn.locationId !== locationId) return false

    return true
  })

  // Enriquece los turnos con nombre de ubicación y nombre del asignado
  const usersById = new Map(db.users.map((u) => [u.id, u]))
  const locationsById = new Map(db.locations.map((l) => [l.id, l]))
  const enriched = turns.map((t) => ({
    ...t,
    assignedToUserName: t.assignedToUserName ?? (t.assignedToUserId ? usersById.get(t.assignedToUserId)?.nombreCompleto : undefined),
    locationNombre: t.locationNombre ?? (t.locationId ? locationsById.get(t.locationId)?.nombre : undefined),
  }))

  response.json(enriched)
})

turnsRouter.post('/', requireRole(['admin']), async (request, response) => {
  const { titulo, descripcion, fecha, hora, horaFin, assignedToUserId, locationId } = request.body ?? {}

  if (!titulo || !fecha || !hora || !assignedToUserId || !locationId) {
    response
      .status(400)
      .json({ message: 'Titulo, fecha, hora, trabajador y ubicacion son requeridos.' })
    return
  }

  const db = await readDatabase()
  const currentUser = db.users.find((item) => item.id === request.authUser!.userId)
  const companyId = resolveCompanyIdForUser(db, currentUser)
  const assignedUser = db.users.find(
    (user) =>
      user.id === assignedToUserId &&
      user.companyId === companyId &&
      (user.role === 'operativo' || user.role === 'supervisor'),
  )
  const location = db.locations.find(
    (item) =>
      item.id === locationId &&
      item.companyId === companyId,
  )

  if (!assignedUser) {
    response.status(404).json({ message: 'El trabajador no existe o no pertenece a esta empresa.' })
    return
  }

  if (!location) {
    response.status(404).json({ message: 'La ubicacion seleccionada no existe.' })
    return
  }

  // Validate: worker must not already have an active turn on the same date
  const conflict = db.turns.find(
    (t) =>
      t.assignedToUserId === assignedToUserId &&
      t.fecha === fecha &&
      t.companyId === companyId &&
      t.estado !== 'finalizado',
  )

  if (conflict) {
    response.status(409).json({
      message: `${assignedUser.nombreCompleto} ya tiene un turno asignado para el ${fecha} (${conflict.titulo}). Finaliza ese turno antes de crear uno nuevo.`,
    })
    return
  }

  const turn = await createTurn({
    companyId,
    titulo,
    descripcion,
    fecha,
    hora,
    horaFin,
    estado: 'asignado',
    creadoPorUserId: request.authUser!.userId,
    assignedToUserId,
    assignedToUserName: assignedUser.nombreCompleto,
    locationId,
    locationNombre: location.nombre,
    confirmedDeadline: buildConfirmedDeadline(String(fecha), String(hora)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  response.status(201).json(turn)
})

turnsRouter.patch('/:turnId/assign', requireRole(['admin']), async (request, response) => {
  const { turnId } = request.params
  const { assignedToUserId } = request.body ?? {}

  if (!assignedToUserId) {
    response.status(400).json({ message: 'El usuario operativo es requerido.' })
    return
  }

  const db = await readDatabase()
  const currentUser = db.users.find((item) => item.id === request.authUser!.userId)
  const companyId = resolveCompanyIdForUser(db, currentUser)
  const turn = db.turns.find(
    (item) => item.id === turnId && item.companyId === companyId,
  )

  if (!turn) {
    response.status(404).json({ message: 'Turno no encontrado.' })
    return
  }

  const operativo = db.users.find(
    (user) =>
      user.id === assignedToUserId &&
      user.companyId === companyId &&
      user.role === 'operativo',
  )

  if (!operativo) {
    response.status(404).json({ message: 'Usuario operativo no encontrado.' })
    return
  }

  turn.assignedToUserId = assignedToUserId
  turn.estado = 'asignado'
  turn.updatedAt = new Date().toISOString()
  await updateTurn(turn)

  response.json(turn)
})

turnsRouter.patch('/:turnId/status', async (request, response) => {
  const { turnId } = request.params
  const { estado } = request.body as { estado?: TurnStatus }

  if (!estado) {
    response.status(400).json({ message: 'El estado es requerido.' })
    return
  }

  const allowedStatus: TurnStatus[] = [
    'pendiente',
    'asignado',
    'en_proceso',
    'finalizado',
    'confirmado',
    'rechazado',
  ]

  if (!allowedStatus.includes(estado)) {
    response.status(400).json({ message: 'Estado de turno no valido.' })
    return
  }

  const db = await readDatabase()
  const currentUser = db.users.find((item) => item.id === request.authUser!.userId)
  const companyId = resolveCompanyIdForUser(db, currentUser)
  const turn = db.turns.find(
    (item) => item.id === turnId && item.companyId === companyId,
  )

  if (!turn) {
    response.status(404).json({ message: 'Turno no encontrado.' })
    return
  }

  const role = request.authUser!.role
  const isSupervisorByRole = role === 'supervisor'
    || (role !== 'admin' && currentUser?.cargo?.toLowerCase().includes('supervisor'))

  // Operativo puro: solo puede actualizar sus propios turnos
  if (!isSupervisorByRole && role === 'operativo' && turn.assignedToUserId !== request.authUser!.userId) {
    response.status(403).json({ message: 'Solo puedes actualizar turnos asignados a tu usuario.' })
    return
  }

  // Supervisor (por rol o por cargo): solo puede confirmar o rechazar
  if (isSupervisorByRole && !['confirmado', 'rechazado'].includes(estado)) {
    response.status(403).json({ message: 'El supervisor solo puede confirmar o rechazar turnos.' })
    return
  }

  turn.estado = estado
  turn.updatedAt = new Date().toISOString()
  await updateTurn(turn)

  response.json(turn)
})

/**
 * GET /turns/:turnId/available-workers
 * Devuelve empleados operativos sin turno activo en la misma fecha del turno.
 */
turnsRouter.get('/:turnId/available-workers', requireRole(['admin']), async (request, response) => {
  const { turnId } = request.params
  const db = await readDatabase()
  const currentUser = db.users.find((u) => u.id === request.authUser!.userId)
  const companyId = resolveCompanyIdForUser(db, currentUser)

  const turn = db.turns.find((t) => t.id === turnId && t.companyId === companyId)
  if (!turn) {
    response.status(404).json({ message: 'Turno no encontrado.' })
    return
  }

  // Empleados con turno activo ese día
  const busyWorkerIds = new Set(
    db.turns
      .filter((t) => t.companyId === companyId && t.fecha === turn.fecha && t.estado !== 'finalizado' && t.estado !== 'rechazado')
      .map((t) => t.assignedToUserId)
      .filter(Boolean)
  )

  const available = db.users.filter(
    (u) => u.companyId === companyId && u.role === 'operativo' && u.activa && !busyWorkerIds.has(u.id)
  )

  response.json(available.map((u) => ({ id: u.id, nombreCompleto: u.nombreCompleto, cargo: u.cargo })))
})

/**
 * PATCH /turns/:turnId/reassign
 * Rechaza el turno del empleado actual y lo reasigna a otro disponible.
 */
turnsRouter.patch('/:turnId/reassign', requireRole(['admin']), async (request, response) => {
  const { turnId } = request.params
  const { newUserId } = request.body as { newUserId?: string }

  if (!newUserId) {
    response.status(400).json({ message: 'El nuevo empleado es requerido.' })
    return
  }

  const db = await readDatabase()
  const currentUser = db.users.find((u) => u.id === request.authUser!.userId)
  const companyId = resolveCompanyIdForUser(db, currentUser)

  const turn = db.turns.find((t) => t.id === turnId && t.companyId === companyId)
  if (!turn) {
    response.status(404).json({ message: 'Turno no encontrado.' })
    return
  }

  const newWorker = db.users.find((u) => u.id === newUserId && u.companyId === companyId && u.role === 'operativo')
  if (!newWorker) {
    response.status(404).json({ message: 'El empleado seleccionado no existe.' })
    return
  }

  // Verifica que el nuevo empleado no tenga turno ese día
  const conflict = db.turns.find(
    (t) => t.assignedToUserId === newUserId && t.fecha === turn.fecha && t.estado !== 'finalizado' && t.estado !== 'rechazado' && t.id !== turnId
  )
  if (conflict) {
    response.status(409).json({ message: `${newWorker.nombreCompleto} ya tiene un turno asignado para ese día.` })
    return
  }

  turn.assignedToUserId  = newWorker.id
  turn.assignedToUserName = newWorker.nombreCompleto
  turn.estado    = 'asignado'
  turn.confirmedDeadline = buildConfirmedDeadline(turn.fecha, turn.hora)
  turn.updatedAt = new Date().toISOString()

  await updateTurn(turn)
  response.json(turn)
})

turnsRouter.delete('/:turnId', requireRole(['admin']), async (request, response) => {
  const turnId = String(request.params.turnId)

  const db = await readDatabase()
  const currentUser = db.users.find((item) => item.id === request.authUser!.userId)
  const companyId = resolveCompanyIdForUser(db, currentUser)
  const turn = db.turns.find(
    (item) => item.id === turnId && item.companyId === companyId,
  )

  if (!turn) {
    response.status(404).json({ message: 'Turno no encontrado.' })
    return
  }

  // Prevent deleting a turn that already has attendance registered
  if (turn.attendance?.checkIn) {
    response.status(409).json({
      message: 'No se puede eliminar un turno con asistencia ya registrada.',
    })
    return
  }

  await deleteTurn(turnId)
  response.status(204).send()
})
