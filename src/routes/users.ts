import { Router } from 'express'
import { createUser, createUserInvitation, readDatabase, updateUser, deleteUser } from '../lib/database.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const usersRouter = Router()

usersRouter.use(requireAuth, requireRole(['admin']))

usersRouter.get('/', async (request, response) => {
  const db = await readDatabase()
  const companyId =
    request.authUser!.companyId ||
    db.users.find((user) => user.id === request.authUser!.userId)?.companyId ||
    ''
  const users = db.users.filter((user) => user.companyId === companyId)

  response.json(users)
})

usersRouter.get('/invitations', async (request, response) => {
  const db = await readDatabase()
  const companyId =
    request.authUser!.companyId ||
    db.users.find((user) => user.id === request.authUser!.userId)?.companyId ||
    ''
  const invitations = db.userInvitations
    .filter((invitation) => invitation.companyId === companyId)
    .map((invitation) => ({
      ...invitation,
      invitePath: `/registro-integrante/${invitation.token}`,
    }))

  response.json(invitations)
})

usersRouter.post('/invitations', async (request, response) => {
  const { positionId, role } = request.body ?? {}

  if (!positionId) {
    response.status(400).json({ message: 'El cargo es requerido para generar el link.' })
    return
  }

  const db = await readDatabase()
  const companyId =
    request.authUser!.companyId ||
    db.users.find((user) => user.id === request.authUser!.userId)?.companyId ||
    ''

  if (!companyId) {
    response.status(400).json({
      message: 'No fue posible identificar la compania asociada al usuario autenticado.',
    })
    return
  }

  const position = db.positions.find(
    (item) => item.id === positionId && item.companyId === companyId,
  )

  if (!position) {
    response.status(404).json({ message: 'El cargo seleccionado no existe.' })
    return
  }

  // Valida el rol según el tipo de empresa
  const company = db.companies.find((c) => c.id === companyId)
  const companyType = company?.tipo ?? 'empresa'
  const validRoles = companyType === 'academia'
    ? ['admin', 'docente', 'estudiante']
    : ['admin', 'supervisor', 'operativo']

  const resolvedRole = validRoles.includes(role) ? role : (companyType === 'academia' ? 'estudiante' : 'operativo')

  const invitation = await createUserInvitation({
    companyId,
    positionId,
    cargo: position.nombre,
    role: resolvedRole,
    invitedByUserId: request.authUser!.userId,
  })

  response.status(201).json({
    ...invitation,
    invitePath: `/registro-integrante/${invitation.token}`,
  })
})

usersRouter.post('/', async (request, response) => {
  const {
    nombreCompleto,
    tipoDocumento,
    numeroDocumento,
    correo,
    telefono,
    positionId,
  } = request.body ?? {}

  if (
    !nombreCompleto ||
    !tipoDocumento ||
    !numeroDocumento ||
    !correo ||
    !telefono ||
    !positionId
  ) {
    response.status(400).json({ message: 'Faltan datos para registrar el usuario.' })
    return
  }

  const db = await readDatabase()
  const companyId =
    request.authUser!.companyId ||
    db.users.find((user) => user.id === request.authUser!.userId)?.companyId ||
    ''

  if (!companyId) {
    response.status(400).json({
      message: 'No fue posible identificar la compania asociada al usuario autenticado.',
    })
    return
  }

  const duplicatedUser = db.users.find(
    (user) => user.correo === correo || user.numeroDocumento === numeroDocumento,
  )

  if (duplicatedUser) {
    response.status(409).json({ message: 'El usuario ya existe.' })
    return
  }

  const position = db.positions.find(
    (item) => item.id === positionId && item.companyId === companyId,
  )

  if (!position) {
    response.status(404).json({ message: 'El puesto operativo no existe.' })
    return
  }

  const user = await createUser({
    companyId,
    nombreCompleto,
    tipoDocumento,
    numeroDocumento,
    correo,
    telefono,
    cargo: position.nombre,
    role: 'operativo',
    positionId,
    activa: true,
    createdAt: new Date().toISOString(),
  })

  response.status(201).json(user)
})

/**
 * GET /users/:userId — detalle de un empleado
 */
usersRouter.get('/:userId', async (request, response) => {
  const db = await readDatabase()
  const companyId =
    request.authUser!.companyId ||
    db.users.find((u) => u.id === request.authUser!.userId)?.companyId || ''

  const user = db.users.find(
    (u) => u.id === request.params.userId && u.companyId === companyId,
  )

  if (!user) {
    response.status(404).json({ message: 'Usuario no encontrado.' })
    return
  }

  response.json(user)
})

/**
 * PATCH /users/:userId — editar datos del empleado
 */
usersRouter.patch('/:userId', async (request, response) => {
  const db = await readDatabase()
  const companyId =
    request.authUser!.companyId ||
    db.users.find((u) => u.id === request.authUser!.userId)?.companyId || ''

  const user = db.users.find(
    (u) => u.id === request.params.userId && u.companyId === companyId,
  )

  if (!user) {
    response.status(404).json({ message: 'Usuario no encontrado.' })
    return
  }

  const {
    nombreCompleto,
    tipoDocumento,
    numeroDocumento,
    correo,
    telefono,
    cargo,
    role,
    positionId,
    activa,
  } = request.body ?? {}

  if (nombreCompleto !== undefined) user.nombreCompleto = String(nombreCompleto)
  if (tipoDocumento !== undefined)  user.tipoDocumento  = String(tipoDocumento)
  if (numeroDocumento !== undefined) user.numeroDocumento = String(numeroDocumento)
  if (correo !== undefined)         user.correo         = String(correo)
  if (telefono !== undefined)       user.telefono       = telefono ? String(telefono) : undefined
  if (cargo !== undefined)          user.cargo          = String(cargo)
  if (role !== undefined)           user.role           = role
  if (positionId !== undefined)     user.positionId     = positionId || undefined
  if (activa !== undefined)         user.activa         = Boolean(activa)

  await updateUser(user)
  response.json(user)
})

/**
 * DELETE /users/:userId — eliminar empleado
 */
usersRouter.delete('/:userId', async (request, response) => {
  const db = await readDatabase()
  const companyId =
    request.authUser!.companyId ||
    db.users.find((u) => u.id === request.authUser!.userId)?.companyId || ''

  const user = db.users.find(
    (u) => u.id === request.params.userId && u.companyId === companyId,
  )

  if (!user) {
    response.status(404).json({ message: 'Usuario no encontrado.' })
    return
  }

  // No permitir eliminarse a sí mismo
  if (user.id === request.authUser!.userId) {
    response.status(403).json({ message: 'No puedes eliminar tu propia cuenta.' })
    return
  }

  await deleteUser(user.id, companyId)
  response.status(204).send()
})
