import { Router } from 'express'
import { signToken } from '../lib/auth.js'
import { getCompaniesCollection, getUsersCollection } from '../lib/mongodb.js'
import { requireAuth, requireRoot } from '../middleware/auth.js'
import type { AccessModule, CompanySettings, CompanyType } from '../types.js'

export const rootRouter = Router()

// ── Credenciales root hardcoded ─────────────────────────────────────────────
const ROOT_USERNAME = 'root'
const ROOT_PASSWORD = '1192920673J'

// ── POST /api/root/login ────────────────────────────────────────────────────
rootRouter.post('/login', (request, response) => {
  const { username, password } = request.body as { username?: string; password?: string }

  if (!username || !password) {
    response.status(400).json({ message: 'Username y password son requeridos.' })
    return
  }

  if (username !== ROOT_USERNAME || password !== ROOT_PASSWORD) {
    response.status(401).json({ message: 'Credenciales root inválidas.' })
    return
  }

  const token = signToken({
    userId: 'root',
    companyId: 'root',
    role: 'root',
  })

  response.json({ token, user: { role: 'root', username: 'root' } })
})

// ── Todas las rutas siguientes requieren autenticación root ─────────────────
rootRouter.use(requireAuth, requireRoot)

// ── GET /api/root/companies ─────────────────────────────────────────────────
rootRouter.get('/companies', async (_request, response) => {
  const companiesCol = await getCompaniesCollection()
  const usersCol = await getUsersCollection()

  const companies = await companiesCol.find({}).toArray()

  const companiesWithStats = await Promise.all(
    companies.map(async (company) => {
      const adminCount = await usersCol.countDocuments({ companyId: company.id, role: 'admin' })
      const employeeCount = await usersCol.countDocuments({ companyId: company.id })

      return {
        id: company.id,
        nombre: company.nombre,
        nit: company.nit,
        correo: company.correo,
        telefono: company.telefono,
        direccion: company.direccion,
        ciudad: company.ciudad,
        tipo: company.tipo,
        activa: company.activa ?? true,
        enabledModules: company.enabledModules,
        adminCount,
        employeeCount,
        createdAt: company.createdAt,
      }
    }),
  )

  response.json(companiesWithStats)
})

// ── PATCH /api/root/companies/:companyId ────────────────────────────────────
rootRouter.patch('/companies/:companyId', async (request, response) => {
  const { companyId } = request.params
  const { activa } = request.body as { activa?: boolean }

  if (typeof activa !== 'boolean') {
    response.status(400).json({ message: 'El campo "activa" (boolean) es requerido.' })
    return
  }

  const companiesCol = await getCompaniesCollection()
  const result = await companiesCol.updateOne(
    { id: companyId },
    { $set: { activa } },
  )

  if (result.matchedCount === 0) {
    response.status(404).json({ message: 'Empresa no encontrada.' })
    return
  }

  response.json({ message: `Empresa ${activa ? 'activada' : 'desactivada'} correctamente.`, activa })
})

// ── POST /api/root/companies/:companyId/assign-admin ────────────────────────
rootRouter.post('/companies/:companyId/assign-admin', async (request, response) => {
  const { companyId } = request.params
  const { userId } = request.body as { userId?: string }

  if (!userId) {
    response.status(400).json({ message: 'El campo "userId" es requerido.' })
    return
  }

  const companiesCol = await getCompaniesCollection()
  const usersCol = await getUsersCollection()

  const company = await companiesCol.findOne({ id: companyId })
  if (!company) {
    response.status(404).json({ message: 'Empresa no encontrada.' })
    return
  }

  const user = await usersCol.findOne({ id: userId })
  if (!user) {
    response.status(404).json({ message: 'Usuario no encontrado.' })
    return
  }

  await usersCol.updateOne(
    { id: userId },
    { $set: { companyId, role: 'admin' } },
  )

  response.json({ message: `Usuario ${user.nombreCompleto} asignado como admin de ${company.nombre}.` })
})

// ── POST /api/root/companies — crear empresa (sin admin) ────────────────────
rootRouter.post('/companies', async (request, response) => {
  const body = request.body as {
    nombre?: string
    nit?: string
    correo?: string
    telefono?: string
    direccion?: string
    ciudad?: string
    tipo?: CompanyType
  }

  if (!body.nombre || !body.nit || !body.correo) {
    response.status(400).json({ message: 'nombre, nit y correo son requeridos.' })
    return
  }

  const companiesCol = await getCompaniesCollection()

  // Verificar NIT duplicado
  const existing = await companiesCol.findOne({ nit: body.nit })
  if (existing) {
    response.status(409).json({ message: 'Ya existe una empresa con ese NIT.' })
    return
  }

  const tipo: CompanyType = body.tipo ?? 'empresa'

  const defaultModules: AccessModule[] = tipo === 'empresa'
    ? ['dashboard', 'turnos-fijos', 'turnos-rotativos', 'horas-extras-recargos', 'geolocalizacion', 'permisos-ausencias', 'biometria-facial', 'teletrabajo', 'facturacion', 'informes', 'configuracion']
    : ['dashboard', 'asistencia-clase', 'codigo-qr', 'asistencia-docente', 'porcentaje-asistencia', 'justificaciones', 'alertas-inasistencia', 'eventos-talleres', 'informes', 'configuracion']

  const defaultSettings: CompanySettings = {
    requireBiometric: true,
    requirePhoto: true,
    requireLocationValidation: true,
    allowAutoCloseMinutes: 480,
    defaultConfirmHoursLimit: 4,
    timezone: 'America/Bogota',
  }

  const newCompany = {
    id: `comp-${Date.now()}`,
    nombre: body.nombre,
    nit: body.nit,
    correo: body.correo,
    telefono: body.telefono,
    direccion: body.direccion,
    ciudad: body.ciudad,
    tipo,
    enabledModules: defaultModules,
    settings: defaultSettings,
    activa: true,
    createdAt: new Date().toISOString(),
  }

  await companiesCol.insertOne(newCompany as any)

  response.status(201).json(newCompany)
})

// ── PATCH /api/root/companies/:companyId/modules ────────────────────────────
// Habilita o deshabilita módulos específicos para una empresa.
// Body: { enabledModules: AccessModule[] }
rootRouter.patch('/companies/:companyId/modules', async (request, response) => {
  const { companyId } = request.params
  const { enabledModules } = request.body as { enabledModules?: AccessModule[] }

  if (!Array.isArray(enabledModules)) {
    response.status(400).json({ message: 'enabledModules (array) es requerido.' })
    return
  }

  const companiesCol = await getCompaniesCollection()
  const result = await companiesCol.updateOne(
    { id: companyId },
    { $set: { enabledModules } },
  )

  if (result.matchedCount === 0) {
    response.status(404).json({ message: 'Empresa no encontrada.' })
    return
  }

  response.json({ message: 'Módulos actualizados correctamente.', enabledModules })
})
