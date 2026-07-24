import { Router } from 'express'
import { resolveCompanyIdForUser } from '../lib/access.js'
import { readDatabase } from '../lib/database.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

export const operationsRouter = Router()

operationsRouter.use(requireAuth, requireRole(['admin', 'supervisor']))

/**
 * GET /operations/by-location
 * Agrupa turnos por ubicación con detalle de empleados asignados.
 * Query: ?fecha=YYYY-MM-DD (opcional, default: hoy)
 */
operationsRouter.get('/by-location', async (request, response) => {
  const db = await readDatabase()
  const currentUser = db.users.find((u) => u.id === request.authUser!.userId)
  const companyId = resolveCompanyIdForUser(db, currentUser)
  const fecha = typeof request.query.fecha === 'string' && request.query.fecha
    ? request.query.fecha
    : new Date().toISOString().slice(0, 10)

  const company = db.companies.find((c) => c.id === companyId)
  const locations = db.locations.filter((l) => l.companyId === companyId)
  const turnsToday = db.turns.filter((t) => t.companyId === companyId && t.fecha === fecha)
  const usersById = new Map(db.users.map((u) => [u.id, u]))

  const result = locations.map((loc) => {
    const turnsAtLocation = turnsToday.filter((t) => t.locationId === loc.id)
    const empleados = turnsAtLocation.map((t) => {
      const user = t.assignedToUserId ? usersById.get(t.assignedToUserId) : undefined
      return {
        turnId: t.id,
        userId: t.assignedToUserId ?? '',
        nombre: user?.nombreCompleto ?? t.assignedToUserName ?? 'Sin asignar',
        cargo: user?.cargo ?? '',
        role: user?.role ?? 'operativo',
        turno: t.titulo,
        horario: t.horaFin ? `${t.hora} - ${t.horaFin}` : t.hora,
        estado: t.estado,
        checkIn: t.attendance?.checkIn?.markedAt ?? null,
        checkOut: t.attendance?.checkOut?.markedAt ?? null,
      }
    })

    // URL de Google Maps con las coordenadas
    const mapsUrl = loc.latitud && loc.longitud
      ? `https://www.google.com/maps/dir/?api=1&destination=${loc.latitud},${loc.longitud}`
      : null

    return {
      locationId: loc.id,
      nombre: loc.nombre,
      direccion: loc.direccion ?? '',
      latitud: loc.latitud,
      longitud: loc.longitud,
      radioTolerancia: loc.radioTolerancia,
      mapsUrl,
      mapsViewUrl: loc.latitud && loc.longitud
        ? `https://www.google.com/maps?q=${loc.latitud},${loc.longitud}`
        : null,
      totalTurnos: turnsAtLocation.length,
      totalEmpleados: empleados.length,
      enCurso: empleados.filter((e) => e.estado === 'en_proceso' || e.estado === 'confirmado').length,
      finalizados: empleados.filter((e) => e.estado === 'finalizado').length,
      empleados,
    }
  }).filter((loc) => loc.totalTurnos > 0) // Solo ubicaciones con turnos ese día

  response.json({
    fecha,
    tipo: company?.tipo ?? 'empresa',
    companyName: company?.nombre ?? '',
    locations: result,
  })
})

/**
 * GET /operations/company-info
 * Info básica de la empresa para diferenciar tipo en el frontend
 */
operationsRouter.get('/company-info', async (request, response) => {
  const db = await readDatabase()
  const currentUser = db.users.find((u) => u.id === request.authUser!.userId)
  const companyId = resolveCompanyIdForUser(db, currentUser)
  const company = db.companies.find((c) => c.id === companyId)

  if (!company) {
    response.status(404).json({ message: 'Empresa no encontrada.' })
    return
  }

  response.json({
    id: company.id,
    nombre: company.nombre,
    tipo: company.tipo,
    enabledModules: company.enabledModules,
    settings: company.settings,
  })
})
