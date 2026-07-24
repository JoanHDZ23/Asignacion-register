import { Router } from 'express'
import { signToken } from '../lib/auth.js'
import { getDefaultModulesByType, getDefaultSettings, resolveAllowedModules } from '../lib/access.js'
import {
  createCompany,
  createUser,
  findUserInvitationByToken,
  readDatabase,
  updateUserInvitation,
} from '../lib/database.js'
import type { CompanyType } from '../types.js'

export const authRouter = Router()

authRouter.post('/register-company', async (request, response) => {
  try {
    const {
      empresa,
      nit,
      correoEmpresa,
      telefonoEmpresa,
      direccionEmpresa,
      ciudadEmpresa,
      tipo,
      adminNombreCompleto,
      adminCorreo,
      adminTelefono,
      adminTipoDocumento,
      adminNumeroDocumento,
    } = request.body ?? {}

    if (
      !empresa ||
      !nit ||
      !correoEmpresa ||
      !adminNombreCompleto ||
      !adminCorreo ||
      !adminTelefono ||
      !adminTipoDocumento ||
      !adminNumeroDocumento
    ) {
      response.status(400).json({ message: 'Faltan datos para registrar la empresa.' })
      return
    }

    const companyType: CompanyType = tipo === 'academia' ? 'academia' : 'empresa'

    const db = await readDatabase()
    const duplicatedCompany = db.companies.find(
      (company) => company.nit === nit || company.correo === correoEmpresa,
    )

    if (duplicatedCompany) {
      response.status(409).json({ message: 'La empresa ya existe.' })
      return
    }

    const duplicatedAdmin = db.users.find(
      (user) =>
        user.correo === adminCorreo ||
        user.numeroDocumento === adminNumeroDocumento,
    )

    if (duplicatedAdmin) {
      response.status(409).json({ message: 'El usuario administrador ya existe.' })
      return
    }

    const company = await createCompany({
      nombre: empresa,
      nit,
      correo: correoEmpresa,
      telefono: telefonoEmpresa,
      direccion: direccionEmpresa,
      ciudad: ciudadEmpresa,
      tipo: companyType,
      enabledModules: getDefaultModulesByType(companyType),
      settings: getDefaultSettings(companyType),
      createdAt: new Date().toISOString(),
    })

    const adminUser = await createUser({
      companyId: company.id,
      nombreCompleto: adminNombreCompleto,
      tipoDocumento: adminTipoDocumento,
      numeroDocumento: adminNumeroDocumento,
      correo: adminCorreo,
      telefono: adminTelefono,
      cargo: 'Administrador principal',
      role: 'admin',
      activa: true,
      createdAt: new Date().toISOString(),
    })

    response.status(201).json({
      message: 'Empresa y administrador creados correctamente.',
      company,
      admin: {
        id: adminUser.id,
        nombreCompleto: adminUser.nombreCompleto,
        correo: adminUser.correo,
        role: adminUser.role,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[register-company] Error:', message)

    if (message.includes('Server selection timed out') || message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT')) {
      response.status(503).json({
        message: 'No se puede conectar a la base de datos. Verifica que MongoDB Atlas tenga la IP de Render en Network Access (0.0.0.0/0).',
        detail: message,
      })
      return
    }

    response.status(500).json({ message: 'Error interno al registrar empresa.', detail: message })
  }
})

authRouter.post('/login', async (request, response) => {
  try {
    const { numeroDocumento } = request.body ?? {}

    if (!numeroDocumento) {
      response.status(400).json({ message: 'El numero de documento es requerido.' })
      return
    }

    const db = await readDatabase()
    const user = db.users.find((candidate) => candidate.numeroDocumento === numeroDocumento)

    if (!user || !user.activa) {
      response.status(401).json({ message: 'Documento no autorizado.' })
      return
    }

    const token = signToken({
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
    })

    response.json({
      token,
      user: {
        id: user.id,
        companyId: user.companyId,
        nombreCompleto: user.nombreCompleto,
        correo: user.correo,
        cargo: user.cargo,
        role: user.role,
        positionId: user.positionId,
        allowedModules: resolveAllowedModules(db, user),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[login] Error:', message)

    if (message.includes('Server selection timed out') || message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT')) {
      response.status(503).json({
        message: 'No se puede conectar a la base de datos.',
        detail: message,
      })
      return
    }

    response.status(500).json({ message: 'Error interno al iniciar sesión.', detail: message })
  }
})

authRouter.get('/member-invitations/:token', async (request, response) => {
  const invitation = await findUserInvitationByToken(request.params.token)

  if (!invitation || invitation.status !== 'pendiente') {
    response.status(404).json({ message: 'El enlace de registro no es valido o ya fue utilizado.' })
    return
  }

  // Verifica expiración (1 hora)
  if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
    response.status(410).json({ message: 'El enlace de registro ha expirado. Solicita uno nuevo al administrador.' })
    return
  }

  const db = await readDatabase()
  const company = db.companies.find((item) => item.id === invitation.companyId)
  const position = db.positions.find((item) => item.id === invitation.positionId)

  response.json({
    token: invitation.token,
    company: company
      ? {
          id: company.id,
          nombre: company.nombre,
        }
      : null,
    position: position
      ? {
          id: position.id,
          nombre: position.nombre,
        }
      : null,
    cargo: invitation.cargo,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
  })
})

authRouter.post('/member-invitations/:token/complete', async (request, response) => {
  const invitation = await findUserInvitationByToken(request.params.token)

  if (!invitation || invitation.status !== 'pendiente') {
    response.status(404).json({ message: 'El enlace de registro no es valido o ya fue utilizado.' })
    return
  }

  // Verifica expiración
  if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
    response.status(410).json({ message: 'El enlace de registro ha expirado. Solicita uno nuevo al administrador.' })
    return
  }

  const { nombreCompleto, tipoDocumento, numeroDocumento, correo, telefono } = request.body ?? {}

  if (!nombreCompleto || !tipoDocumento || !numeroDocumento || !correo || !telefono) {
    response.status(400).json({ message: 'Faltan datos para completar el registro.' })
    return
  }

  const db = await readDatabase()
  const duplicatedUser = db.users.find(
    (user) => user.correo === correo || user.numeroDocumento === numeroDocumento,
  )

  if (duplicatedUser) {
    response.status(409).json({ message: 'El usuario ya existe.' })
    return
  }

  const position = db.positions.find(
    (item) =>
      item.id === invitation.positionId &&
      item.companyId === invitation.companyId,
  )

  if (!position) {
    response.status(404).json({ message: 'El cargo asignado en la invitacion no existe.' })
    return
  }

  const user = await createUser({
    companyId: invitation.companyId,
    nombreCompleto,
    tipoDocumento,
    numeroDocumento,
    correo,
    telefono,
    cargo: invitation.cargo,
    role: invitation.role,
    positionId: invitation.positionId,
    activa: true,
    createdAt: new Date().toISOString(),
  })

  invitation.status = 'completada'
  invitation.invitedUserId = user.id
  invitation.completedAt = new Date().toISOString()
  await updateUserInvitation(invitation)

  response.status(201).json({
    message: 'Registro completado correctamente.',
    user: {
      id: user.id,
      nombreCompleto: user.nombreCompleto,
      cargo: user.cargo,
      role: user.role,
      numeroDocumento: user.numeroDocumento,
    },
  })
})
