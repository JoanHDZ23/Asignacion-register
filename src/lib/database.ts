/**
 * Database module — MongoDB Atlas como fuente primaria.
 * Apps Script se usa SOLO para subir fotos faciales a Google Drive.
 */
import { nanoid } from 'nanoid'
import {
  getCompaniesCollection,
  getFacturasCollection,
  getGroupsCollection,
  getHorasTurnoCollection,
  getLocationsCollection,
  getPositionsCollection,
  getTurnsCollection,
  getUserInvitationsCollection,
  getUsersCollection,
} from './mongodb.js'
import type {
  AccessModule,
  Company,
  DatabaseSchema,
  HorasTurnoRecord,
  Location,
  OperationGroup,
  Position,
  StoredWebAuthnCredential,
  Turn,
  User,
  UserInvitation,
} from '../types.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeCredentialTransports(value: unknown): StoredWebAuthnCredential['transports'] {
  if (!Array.isArray(value)) return undefined
  const transports = value.filter((item): item is string => typeof item === 'string')
  return transports.length ? transports : undefined
}

export function normalizeUserBiometricProfile(user: User) {
  const biometric = user.biometric
  if (!biometric) return undefined
  return {
    ...biometric,
    credentials: Array.isArray(biometric.credentials)
      ? biometric.credentials.map((credential) => ({
          ...credential,
          publicKey: Array.isArray(credential.publicKey)
            ? credential.publicKey.filter((item): item is number => typeof item === 'number')
            : [],
          transports: normalizeCredentialTransports(credential.transports),
        }))
      : [],
  }
}

const defaultPositionPermissions: AccessModule[] = ['dashboard', 'turnos-fijos']

// ── Apps Script — SOLO para fotos de Drive ───────────────────────────────────

const remoteDatabaseUrl = process.env.APPS_SCRIPT_DB_URL ?? ''

export async function uploadFacialPhoto(params: {
  userId: string
  userName: string
  turnId: string
  action: 'entrada' | 'salida'
  imageBase64: string
  mimeType?: string
}): Promise<string | null> {
  if (!remoteDatabaseUrl) return null

  try {
    const response = await fetch(remoteDatabaseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        action: 'uploadFacialPhoto',
        table: 'asignaciones',
        payload: {
          userId: params.userId,
          userName: params.userName,
          turnId: params.turnId,
          action: params.action,
          imageBase64: params.imageBase64,
          mimeType: params.mimeType ?? 'image/jpeg',
        },
      }),
    })

    if (response.ok) {
      const body = (await response.json()) as { success?: boolean; data?: { url?: string } }
      if (body.success && body.data?.url) return body.data.url
    }
  } catch (error) {
    console.warn('[drive] No fue posible subir la foto a Drive.', error)
  }

  return null
}

// ── readDatabase — lectura completa para compatibilidad ──────────────────────

export async function readDatabase(): Promise<DatabaseSchema> {
  const [companies, users, positions, locations, turns, userInvitations, horasTurno, facturas, groups] =
    await Promise.all([
      getCompaniesCollection().then((c) => c.find().toArray()),
      getUsersCollection().then((c) => c.find().toArray()),
      getPositionsCollection().then((c) => c.find().toArray()),
      getLocationsCollection().then((c) => c.find().toArray()),
      getTurnsCollection().then((c) => c.find().toArray()),
      getUserInvitationsCollection().then((c) => c.find().toArray()),
      getHorasTurnoCollection().then((c) => c.find().toArray()),
      getFacturasCollection().then((c) => c.find().toArray()),
      getGroupsCollection().then((c) => c.find().toArray()),
    ])

  return { companies, users, positions, locations, turns, userInvitations, horasTurno, facturas, groups } as DatabaseSchema
}

export async function writeDatabase(_data: DatabaseSchema) {
  // No-op — cada operación guarda directamente en MongoDB
}

// ── Company ──────────────────────────────────────────────────────────────────

export async function createCompany(company: Omit<Company, 'id'>) {
  const col = await getCompaniesCollection()
  const doc: Company = { id: `company-${Date.now()}`, ...company }
  await col.insertOne(doc as any)
  return doc
}

export async function updateCompany(company: Company) {
  const col = await getCompaniesCollection()
  await col.updateOne({ id: company.id }, { $set: company as any })
  return company
}

// ── User ─────────────────────────────────────────────────────────────────────

export async function createUser(user: Omit<User, 'id'>) {
  const col = await getUsersCollection()
  const doc: User = {
    id: `user-${Date.now()}`,
    biometric: normalizeUserBiometricProfile(user as User),
    ...user,
  }
  await col.insertOne(doc as any)
  return doc
}

export async function updateUser(user: User) {
  const normalized: User = { ...user, biometric: normalizeUserBiometricProfile(user) }
  const col = await getUsersCollection()
  await col.updateOne({ id: user.id }, { $set: normalized as any })
  return normalized
}

export async function updateUserLocal(user: User) {
  return updateUser(user)
}

export async function readLocalUser(userId: string): Promise<User | null> {
  const col = await getUsersCollection()
  return (await col.findOne({ id: userId })) as User | null
}

export async function deleteUser(userId: string, _companyId: string) {
  const col = await getUsersCollection()
  await col.deleteOne({ id: userId })
}

// ── Position ─────────────────────────────────────────────────────────────────

export async function createPosition(position: Omit<Position, 'id'>) {
  const col = await getPositionsCollection()
  const doc: Position = {
    id: `position-${Date.now()}`,
    ...position,
    permissions: position.permissions?.length ? position.permissions : defaultPositionPermissions,
  }
  await col.insertOne(doc as any)
  return doc
}

export async function updatePosition(position: Position) {
  const col = await getPositionsCollection()
  await col.updateOne({ id: position.id }, { $set: position as any })
  return position
}

// ── Location ─────────────────────────────────────────────────────────────────

export async function createLocation(location: Omit<Location, 'id'>) {
  const col = await getLocationsCollection()
  const doc: Location = { id: `location-${Date.now()}`, ...location }
  await col.insertOne(doc as any)
  return doc
}

export async function updateLocation(location: Location) {
  const col = await getLocationsCollection()
  await col.updateOne({ id: location.id }, { $set: location as any })
  return location
}

export async function deleteLocation(locationId: string, _companyId: string) {
  const col = await getLocationsCollection()
  await col.deleteOne({ id: locationId })
}

// ── Turn ─────────────────────────────────────────────────────────────────────

export async function createTurn(turn: Omit<Turn, 'id'>) {
  const col = await getTurnsCollection()
  const doc: Turn = { id: `turn-${Date.now()}`, ...turn }
  await col.insertOne(doc as any)
  return doc
}

export async function updateTurn(turn: Turn) {
  const col = await getTurnsCollection()
  await col.updateOne({ id: turn.id }, { $set: turn as any })
  return turn
}

export async function deleteTurn(turnId: string) {
  const col = await getTurnsCollection()
  await col.deleteOne({ id: turnId })
}

// ── UserInvitation ───────────────────────────────────────────────────────────

export async function createUserInvitation(
  invitation: Omit<UserInvitation, 'id' | 'token' | 'status' | 'createdAt'>,
) {
  const col = await getUserInvitationsCollection()
  const doc: UserInvitation = {
    id: `invite-${Date.now()}`,
    token: nanoid(24),
    status: 'pendiente',
    createdAt: new Date().toISOString(),
    ...invitation,
  }
  await col.insertOne(doc as any)
  return doc
}

export async function updateUserInvitation(invitation: UserInvitation) {
  const col = await getUserInvitationsCollection()
  await col.updateOne({ id: invitation.id }, { $set: invitation as any })
  return invitation
}

export async function findUserInvitationByToken(token: string): Promise<UserInvitation | null> {
  const col = await getUserInvitationsCollection()
  return (await col.findOne({ token })) as UserInvitation | null
}

// ── Horas por Turno ──────────────────────────────────────────────────────────

const festivosColombia2026 = new Set([
  '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
  '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
  '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
  '2026-11-16', '2026-12-08', '2026-12-25',
])

function getDiaSemana(fecha: string): string {
  const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
  return dias[new Date(fecha + 'T12:00:00').getDay()] ?? ''
}

export async function registerHorasTurno(params: {
  turn: Turn
  userName: string
  cargo: string
  locationNombre?: string
  valorHora?: number
  confirmadoPor?: string
  recargoDominical?: number
  recargoFestivo?: number
}) {
  const { turn, userName, cargo, locationNombre, valorHora, confirmadoPor } = params
  const recargoDominical = params.recargoDominical ?? 75
  const recargoFestivo = params.recargoFestivo ?? 100
  const checkIn = turn.attendance?.checkIn?.markedAt
  const checkOut = turn.attendance?.checkOut?.markedAt
  if (!checkIn) return null

  let horasTrabajadas = 0
  if (checkIn && checkOut) {
    const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime()
    horasTrabajadas = diff > 0 ? Math.round((diff / 3_600_000) * 100) / 100 : 0
  }

  const diaSemana = getDiaSemana(turn.fecha)
  const esDominical = diaSemana === 'domingo'
  const esFestivo = festivosColombia2026.has(turn.fecha)

  let horasOrdinarias = 0, horasDominicales = 0, horasFestivas = 0
  if (esFestivo) horasFestivas = horasTrabajadas
  else if (esDominical) horasDominicales = horasTrabajadas
  else horasOrdinarias = horasTrabajadas

  const subtotalOrdinario = valorHora ? Math.round(horasOrdinarias * valorHora * 100) / 100 : undefined
  const subtotalDominical = valorHora ? Math.round(horasDominicales * valorHora * (1 + recargoDominical / 100) * 100) / 100 : undefined
  const subtotalFestivo = valorHora ? Math.round(horasFestivas * valorHora * (1 + recargoFestivo / 100) * 100) / 100 : undefined
  const subtotal = valorHora ? (subtotalOrdinario ?? 0) + (subtotalDominical ?? 0) + (subtotalFestivo ?? 0) : undefined

  const fmtTime = (iso: string | undefined) => {
    if (!iso) return undefined
    try { return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) } catch { return undefined }
  }

  const record: HorasTurnoRecord = {
    id: `ht-${Date.now()}-${nanoid(4)}`,
    companyId: turn.companyId,
    turnId: turn.id,
    userId: turn.assignedToUserId ?? '',
    nombreUsuario: userName || turn.assignedToUserName || '',
    cargo,
    locationId: turn.locationId,
    nombreUbicacion: locationNombre ?? turn.locationNombre,
    fecha: turn.fecha,
    diaSemana, esDominical, esFestivo,
    horaEntradaEsperada: turn.hora,
    horaSalidaEsperada: turn.horaFin,
    horaEntradaReal: fmtTime(checkIn),
    horaSalidaReal: fmtTime(checkOut),
    horasTrabajadas, horasOrdinarias, horasDominicales, horasFestivas,
    metodoSalida: turn.attendance?.checkOut?.method,
    valorHora, recargoDominical, recargoFestivo,
    subtotalOrdinario, subtotalDominical, subtotalFestivo, subtotal,
    estadoTurno: turn.estado,
    confirmadoPor,
    createdAt: new Date().toISOString(),
  }

  const col = await getHorasTurnoCollection()
  await col.insertOne(record as any)
  return record
}
