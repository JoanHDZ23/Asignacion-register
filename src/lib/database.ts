import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import type {
  AccessModule,
  Company,
  DatabaseSchema,
  Location,
  Position,
  StoredWebAuthnCredential,
  Turn,
  User,
  UserInvitation,
} from '../types.js'

const dataDirectory = path.resolve(process.cwd(), 'data')
const databasePath = path.join(dataDirectory, 'db.json')
const remoteDatabaseUrl =
  process.env.APPS_SCRIPT_DB_URL ??
  'https://script.google.com/macros/s/AKfycbzQJMq7DlAXbJ7uqaivBIXz2gn-hytkAxnQxM5zTVI9wMRWsw4GepK2X-2cPOWZIG2C/exec'

const defaultDatabase: DatabaseSchema = {
  companies: [],
  users: [],
  positions: [],
  locations: [],
  turns: [],
  userInvitations: [],
}

const defaultPositionPermissions: AccessModule[] = ['dashboard', 'asignacion-turnos']

type AppsScriptTable = 'companias' | 'usuarios' | 'cargos' | 'ubicaciones' | 'asignaciones'

type AppsScriptListResponse = {
  success?: boolean
  data?: Record<string, unknown>[]
  error?: string
}

type AppsScriptMutationResponse = {
  success?: boolean
  data?: Record<string, unknown>
  row?: Record<string, unknown>
  error?: string
}

async function ensureDatabaseFile() {
  await mkdir(dataDirectory, { recursive: true })

  try {
    await readFile(databasePath, 'utf8')
  } catch {
    await writeFile(databasePath, JSON.stringify(defaultDatabase, null, 2))
  }
}

function cloneDefaultDatabase() {
  return structuredClone(defaultDatabase)
}

function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return ['true', 'activo', 'activa', '1', 'si'].includes(value.toLowerCase())
  }

  if (typeof value === 'number') {
    return value === 1
  }

  return false
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function getOptionalString(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return undefined
  }

  return String(value)
}

function looksLikeEmail(value: string | undefined) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
}

function looksLikeCompanyId(value: string | undefined) {
  return Boolean(value && /^company-/i.test(value))
}

function looksLikePositionId(value: string | undefined) {
  return Boolean(value && /^position-/i.test(value))
}

function looksLikeRole(value: string | undefined) {
  return value === 'admin' || value === 'supervisor' || value === 'operativo'
}

function looksLikePhoneValue(value: string | undefined) {
  return Boolean(value && /^[+\d][\d\s-]{6,}$/.test(value))
}

function parsePermissionsValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is AccessModule => typeof item === 'string')
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is AccessModule => typeof item === 'string')
      }
    } catch {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter((item): item is AccessModule => Boolean(item))
    }
  }

  return []
}

async function readLocalDatabase() {
  await ensureDatabaseFile()
  const raw = await readFile(databasePath, 'utf8')

  try {
    const parsed = JSON.parse(raw) as Partial<DatabaseSchema>
    return {
      ...cloneDefaultDatabase(),
      ...parsed,
      companies: parsed.companies ?? [],
      users: parsed.users ?? [],
      positions: parsed.positions ?? [],
      locations: parsed.locations ?? [],
      turns: parsed.turns ?? [],
      userInvitations: parsed.userInvitations ?? [],
    }
  } catch {
    return cloneDefaultDatabase()
  }
}

async function writeLocalDatabase(data: DatabaseSchema) {
  await ensureDatabaseFile()
  await writeFile(databasePath, JSON.stringify(data, null, 2))
}

function upsertEntity<T extends { id: string }>(collection: T[], entity: T) {
  const index = collection.findIndex((item) => item.id === entity.id)

  if (index >= 0) {
    collection[index] = entity
    return
  }

  collection.push(entity)
}

async function persistLocalCompany(entity: Company) {
  const db = await readLocalDatabase()
  upsertEntity(db.companies, entity)
  await writeLocalDatabase(db)
}

async function persistLocalUser(entity: User) {
  const db = await readLocalDatabase()
  upsertEntity(db.users, entity)
  await writeLocalDatabase(db)
}

async function persistLocalPosition(entity: Position) {
  const db = await readLocalDatabase()
  upsertEntity(db.positions, entity)
  await writeLocalDatabase(db)
}

async function persistLocalLocation(entity: Location) {
  const db = await readLocalDatabase()
  upsertEntity(db.locations, entity)
  await writeLocalDatabase(db)
}

async function persistLocalTurn(entity: Turn) {
  const db = await readLocalDatabase()
  upsertEntity(db.turns, entity)
  await writeLocalDatabase(db)
}

async function persistLocalInvitation(entity: UserInvitation) {
  const db = await readLocalDatabase()
  upsertEntity(db.userInvitations, entity)
  await writeLocalDatabase(db)
}

function mergeRemoteUsersWithLocalFields(localItems: User[], remoteItems: User[]) {
  const localById = new Map(localItems.map((item) => [item.id, item]))

  return remoteItems.map((remoteItem) => {
    const localItem = localById.get(remoteItem.id)
    return localItem
      ? {
          ...remoteItem,
          biometric: localItem.biometric ?? remoteItem.biometric,
          createdAt: remoteItem.createdAt || localItem.createdAt,
        }
      : remoteItem
  })
}

function mergeRemotePositionsWithLocalFields(localItems: Position[], remoteItems: Position[]) {
  const localById = new Map(localItems.map((item) => [item.id, item]))

  return remoteItems.map((remoteItem) => {
    const localItem = localById.get(remoteItem.id)
    return localItem
      ? {
          ...remoteItem,
          permissions: remoteItem.permissions.length
            ? remoteItem.permissions
            : localItem.permissions,
          descripcion: remoteItem.descripcion ?? localItem.descripcion,
          createdAt: remoteItem.createdAt || localItem.createdAt,
        }
      : remoteItem
  })
}

function mergeRemoteTurnsWithLocalFields(localItems: Turn[], remoteItems: Turn[]) {
  const localById = new Map(localItems.map((item) => [item.id, item]))

  return remoteItems.map((remoteItem) => {
    const localItem = localById.get(remoteItem.id)
    return localItem
      ? {
          ...remoteItem,
          titulo: remoteItem.titulo || localItem.titulo,
          descripcion: remoteItem.descripcion ?? localItem.descripcion,
          creadoPorUserId: remoteItem.creadoPorUserId || localItem.creadoPorUserId,
          attendance: localItem.attendance ?? remoteItem.attendance,
          createdAt: remoteItem.createdAt || localItem.createdAt,
          updatedAt: remoteItem.updatedAt || localItem.updatedAt,
        }
      : remoteItem
  })
}

function mergeRemoteSimpleFields<T extends { id: string }>(localItems: T[], remoteItems: T[]) {
  const localById = new Map(localItems.map((item) => [item.id, item]))

  return remoteItems.map((remoteItem) => {
    const localItem = localById.get(remoteItem.id)
    return localItem ? { ...remoteItem, createdAt: (remoteItem as { createdAt?: string }).createdAt || (localItem as { createdAt?: string }).createdAt } : remoteItem
  })
}

async function fetchAppsScriptRows(table: AppsScriptTable) {
  if (!remoteDatabaseUrl) {
    return null
  }

  const response = await fetch(`${remoteDatabaseUrl}?table=${encodeURIComponent(table)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Apps Script respondio con estado ${response.status}.`)
  }

  const payload = (await response.json()) as AppsScriptListResponse

  if (payload.success === false) {
    throw new Error(payload.error ?? 'No fue posible listar los registros remotos.')
  }

  return Array.isArray(payload.data) ? payload.data : []
}

async function postAppsScript(
  action: 'create' | 'update' | 'delete',
  table: AppsScriptTable,
  payload: Record<string, unknown>,
) {
  if (!remoteDatabaseUrl) {
    return null
  }

  const response = await fetch(remoteDatabaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ action, table, payload }),
  })

  if (!response.ok) {
    throw new Error(`Apps Script respondio con estado ${response.status}.`)
  }

  const mutationPayload = (await response.json()) as AppsScriptMutationResponse

  if (mutationPayload.success === false) {
    throw new Error(mutationPayload.error ?? 'No fue posible mutar el registro remoto.')
  }

  return mutationPayload
}

function mapCompanyRow(row: Record<string, unknown>): Company {
  // Parse settings JSON si viene de Sheets
  let settings: Company['settings'] = {
    requireBiometric: true,
    requirePhoto: true,
    requireLocationValidation: true,
    allowAutoCloseMinutes: 30,
    defaultConfirmHoursLimit: 4,
    timezone: 'America/Bogota',
  }
  try {
    const rawSettings = row.settings_json ?? row.settings
    if (typeof rawSettings === 'string' && rawSettings.trim()) {
      settings = { ...settings, ...JSON.parse(rawSettings) }
    } else if (typeof rawSettings === 'object' && rawSettings) {
      settings = { ...settings, ...(rawSettings as object) }
    }
  } catch { /* usa defaults */ }

  let enabledModules: Company['enabledModules'] = ['dashboard', 'asignacion-turnos', 'gestion-asistencia']
  try {
    const rawModules = row.enabled_modules ?? row.enabledModules
    if (typeof rawModules === 'string' && rawModules.trim()) {
      enabledModules = JSON.parse(rawModules)
    } else if (Array.isArray(rawModules)) {
      enabledModules = rawModules as Company['enabledModules']
    }
  } catch { /* usa defaults */ }

  return {
    id: getString(row.id_compania ?? row.company_id ?? row['ID Empresa'] ?? row.id),
    nombre: getString(row.nombre_empresa ?? row['Nombre Empresa'] ?? row.nombre ?? ''),
    nit: getString(row.nit ?? row.NIT ?? ''),
    correo: getString(row.correo_electronico ?? row['Correo Empresa'] ?? row.Correo ?? ''),
    telefono: getOptionalString(row.telefono ?? row['Telefono Empresa'] ?? row.Telefono),
    direccion: getOptionalString(row.direccion ?? row.Direccion),
    ciudad: getOptionalString(row.ciudad ?? row.Ciudad),
    tipo: (getString(row.tipo ?? 'empresa') as Company['tipo']) || 'empresa',
    enabledModules,
    settings,
    createdAt: getString(
      row.created_at ?? row['Creado En'] ?? row['Fecha Creacion'] ?? new Date().toISOString(),
    ),
  }
}

function companyToRemoteRow(company: Company) {
  return {
    id_compania: company.id,
    nombre_empresa: company.nombre,
    nit: company.nit,
    correo_electronico: company.correo,
    telefono: company.telefono ?? '',
    direccion: company.direccion ?? '',
    ciudad: company.ciudad ?? '',
    tipo: company.tipo ?? 'empresa',
    enabled_modules: JSON.stringify(company.enabledModules ?? []),
    settings_json: JSON.stringify(company.settings ?? {}),
    created_at: company.createdAt,
  }
}

function normalizeLegacyUserRow(row: Record<string, unknown>) {
  const normalizedRow = { ...row }
  const rawTipoDocumento = getOptionalString(row.tipo_documento ?? row['Tipo Documento'])
  const rawDocumentoId = getOptionalString(row.documento_id ?? row['Numero Documento'])
  const rawPositionId = getOptionalString(row.id_cargo ?? row['ID Cargo'])
  const rawCargo = getOptionalString(row.cargo ?? row.Cargo)
  const rawCorreo = getOptionalString(row.correo_electronico ?? row.Correo)
  const rawTelefono = getOptionalString(row.telefono ?? row.Telefono)
  const rawRole = getOptionalString(row.rol_sistema ?? row.Rol)

  if (
    !getOptionalString(row.id_compania ?? row.company_id ?? row['ID Compania']) &&
    looksLikeCompanyId(rawRole)
  ) {
    normalizedRow.id_compania = rawRole
    normalizedRow.rol_sistema = rawCorreo
    normalizedRow.correo_electronico = looksLikeEmail(rawPositionId) ? rawPositionId : ''
    normalizedRow.id_cargo = looksLikePositionId(rawDocumentoId) ? rawDocumentoId : ''
    normalizedRow.documento_id = rawTipoDocumento ?? ''
    normalizedRow.tipo_documento = ''
    normalizedRow.telefono = looksLikePhoneValue(rawCargo) ? rawCargo : ''
    normalizedRow.estado = rawTelefono ?? row.estado ?? row.Activa
    normalizedRow.cargo = ''
  }

  return normalizedRow
}

function mapUserRow(
  row: Record<string, unknown>,
  positionsById: Map<string, Position> = new Map(),
): User {
  const normalizedRow = normalizeLegacyUserRow(row)
  const positionId = getOptionalString(normalizedRow.id_cargo ?? normalizedRow['ID Cargo'])
  const position = positionId ? positionsById.get(positionId) : undefined

  const biometric = normalizedRow.biometric as User['biometric'] | undefined
  const rawCargo = getOptionalString(normalizedRow.cargo ?? normalizedRow.Cargo)
  const resolvedCargo =
    position?.nombre ||
    (rawCargo && !looksLikePhoneValue(rawCargo) && !looksLikeRole(rawCargo) ? rawCargo : undefined) ||
    ''

  return {
    id: getString(normalizedRow.id_usuario ?? normalizedRow['ID Usuario'] ?? normalizedRow.id),
    companyId: getString(
      normalizedRow.company_id ?? normalizedRow.id_compania ?? position?.companyId ?? '',
    ),
    nombreCompleto: getString(normalizedRow.nombre_completo ?? normalizedRow['Nombre Completo'] ?? ''),
    tipoDocumento: getString(normalizedRow.tipo_documento ?? normalizedRow['Tipo Documento'] ?? ''),
    numeroDocumento: getString(normalizedRow.documento_id ?? normalizedRow['Numero Documento'] ?? ''),
    correo: getString(normalizedRow.correo_electronico ?? normalizedRow.Correo ?? ''),
    telefono: getOptionalString(normalizedRow.telefono ?? normalizedRow.Telefono),
    cargo: resolvedCargo || (getString(normalizedRow.rol_sistema ?? normalizedRow.Rol) === 'admin'
      ? 'Administrador principal'
      : getString(normalizedRow.rol_sistema ?? normalizedRow.Rol) === 'supervisor'
        ? 'Supervisor'
        : ''),
    role: getString(normalizedRow.rol_sistema ?? normalizedRow.Rol) === 'admin'
      ? 'admin'
      : getString(normalizedRow.rol_sistema ?? normalizedRow.Rol) === 'supervisor'
        ? 'supervisor'
        : 'operativo',
    positionId,
    activa: parseBoolean(normalizedRow.estado ?? normalizedRow.Activa),
    biometric,
    createdAt: getString(
      normalizedRow.created_at ?? normalizedRow['Creado En'] ?? new Date().toISOString(),
    ),
  }
}

function userToRemoteRow(user: User) {
  return {
    id_usuario: user.id,
    nombre_completo: user.nombreCompleto,
    tipo_documento: user.tipoDocumento,
    documento_id: user.numeroDocumento,
    id_cargo: user.positionId ?? '',
    cargo: user.cargo,
    correo_electronico: user.correo,
    telefono: user.telefono ?? '',
    rol_sistema: user.role,
    estado: user.activa ? 'Activo' : 'Inactivo',
    id_compania: user.companyId,
    created_at: user.createdAt,
  }
}

function mapPositionRow(row: Record<string, unknown>): Position {
  const permissions = parsePermissionsValue(row.permissions)

  return {
    id: getString(row.id_cargo ?? row['ID Cargo'] ?? row.id),
    companyId: getString(row.id_compania ?? row.company_id ?? row['ID Empresa'] ?? ''),
    nombre: getString(row.nombre_cargo ?? row['Nombre del Cargo'] ?? ''),
    descripcion: getOptionalString(row.descripcion ?? row.Descripcion ?? row['Descripción']),
    permissions,
    activa: parseBoolean(row.estado ?? row.Estado ?? row.Activa),
    createdAt: getString(row.created_at ?? row['Creado En'] ?? new Date().toISOString()),
  }
}

function positionToRemoteRow(position: Position) {
  return {
    id_cargo: position.id,
    nombre_cargo: position.nombre,
    id_compania: position.companyId,
    area: 'Operativa',
    descripcion: position.descripcion ?? '',
    estado: position.activa ? 'Activo' : 'Inactivo',
    permissions: JSON.stringify(position.permissions),
    created_at: position.createdAt,
  }
}

function mapLocationRow(row: Record<string, unknown>): Location {
  return {
    id: getString(row.id_ubicacion ?? row.id),
    companyId: getString(row.id_compania ?? row.company_id ?? ''),
    nombre: getString(row.nombre_punto ?? row.nombre ?? ''),
    direccion: getOptionalString(row.direccion ?? row.Direccion),
    latitud: getOptionalString(row.latitud ?? row.Latitud),
    longitud: getOptionalString(row.longitud ?? row.Longitud),
    radioTolerancia: getOptionalString(row.radio_tolerancia ?? row.radio ?? row.Radio),
    descripcion: getOptionalString(row.descripcion ?? row.Descripcion),
    createdAt: getString(row.created_at ?? new Date().toISOString()),
  }
}

function locationToRemoteRow(location: Location) {
  return {
    id_ubicacion: location.id,
    nombre_punto: location.nombre,
    id_compania: location.companyId,
    direccion: location.direccion ?? '',
    latitud: location.latitud ?? '',
    longitud: location.longitud ?? '',
    radio_tolerancia: location.radioTolerancia ?? '',
    descripcion: location.descripcion ?? '',
    created_at: location.createdAt,
  }
}

function mapTurnRow(row: Record<string, unknown>): Turn {
  const attendance = row.attendance as Turn['attendance'] | undefined

  // Convierte un valor de celda de Sheets a string de fecha YYYY-MM-DD
  function toDateString(val: unknown): string {
    if (!val) return ''
    if (val instanceof Date) {
      const y = val.getFullYear()
      const m = String(val.getMonth() + 1).padStart(2, '0')
      const d = String(val.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
    const s = String(val).trim()
    // Ya viene como YYYY-MM-DD o similar
    const match = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (match) return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`
    return s
  }

  // Convierte un valor de celda de Sheets a string de hora HH:MM
  function toTimeString(val: unknown): string {
    if (!val) return ''
    if (val instanceof Date) {
      return `${String(val.getHours()).padStart(2,'0')}:${String(val.getMinutes()).padStart(2,'0')}`
    }
    const s = String(val).trim()
    // Ya viene como HH:MM
    const match = s.match(/(\d{1,2}):(\d{2})/)
    if (match) return `${match[1].padStart(2,'0')}:${match[2]}`
    return s
  }

  return {
    id: getString(row.id_asignacion ?? row.id),
    companyId: '',
    titulo: getString(row.titulo ?? ''),
    descripcion: getOptionalString(row.descripcion ?? row.Descripcion),
    fecha: toDateString(row.fecha ?? row.Fecha),
    hora: toTimeString(row.hora_entrada_esperada ?? row.hora),
    horaFin: toTimeString(row.hora_salida_esperada ?? row.horaFin) || undefined,
    estado: getString(row.estado_turno ?? row.estado ?? 'pendiente') as Turn['estado'],
    creadoPorUserId: getString(row.creado_por ?? ''),
    assignedToUserId: getOptionalString(row.id_usuario ?? row.assignedToUserId),
    locationId: getOptionalString(row.id_ubicacion ?? row.locationId),
    attendance,
    createdAt: getString(row.created_at ?? new Date().toISOString()),
    updatedAt: getString(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  }
}

function normalizeCredentialTransports(
  value: unknown,
): StoredWebAuthnCredential['transports'] {
  if (!Array.isArray(value)) {
    return undefined
  }

  const transports = value.filter((item): item is string => typeof item === 'string')
  return transports.length ? transports : undefined
}

export function normalizeUserBiometricProfile(user: User) {
  const biometric = user.biometric

  if (!biometric) {
    return undefined
  }

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

function turnToRemoteRow(turn: Turn) {
  const facialUrl =
    turn.attendance?.checkOut?.facialPhotoUrl ??
    turn.attendance?.checkIn?.facialPhotoUrl ??
    ''

  // Formatea un timestamp ISO a hora local HH:MM
  const fmtTime = (iso: string | undefined) => {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
    } catch { return '' }
  }

  return {
    id_asignacion:        turn.id,
    id_usuario:           turn.assignedToUserId ?? '',
    id_ubicacion:         turn.locationId ?? '',
    fecha:                turn.fecha,
    hora_entrada_esperada: turn.hora,
    hora_salida_esperada:  turn.horaFin ?? '',
    tiempo_descanso:      '',
    hora_entrada_real:    fmtTime(turn.attendance?.checkIn?.markedAt),
    hora_salida_real:     fmtTime(turn.attendance?.checkOut?.markedAt),
    estado_turno:         turn.estado,
    titulo:               turn.titulo,
    descripcion:          turn.descripcion ?? '',
    creado_por:           turn.creadoPorUserId,
    created_at:           turn.createdAt,
    updated_at:           turn.updatedAt,
    registro_facial:      facialUrl,
  }
}

function pickMutationRow(payload: AppsScriptMutationResponse | null) {
  if (!payload) {
    return null
  }

  if (payload.data && typeof payload.data === 'object') {
    const record = payload.data['record']

    if (record && typeof record === 'object') {
      return record as Record<string, unknown>
    }

    return payload.data
  }

  if (payload.row && typeof payload.row === 'object') {
    return payload.row
  }

  return null
}

export async function readDatabase() {
  const localDb = await readLocalDatabase()

  try {
    const [companiesRows, usersRows, positionsRows, locationsRows, turnsRows] = await Promise.all([
      fetchAppsScriptRows('companias'),
      fetchAppsScriptRows('usuarios'),
      fetchAppsScriptRows('cargos'),
      fetchAppsScriptRows('ubicaciones'),
      fetchAppsScriptRows('asignaciones'),
    ])

    if (companiesRows && usersRows && positionsRows && locationsRows && turnsRows) {
      const remotePositions = positionsRows.map(mapPositionRow)
      const remoteLocations = locationsRows.map(mapLocationRow)
      const positionsById = new Map(remotePositions.map((position) => [position.id, position]))
      const locationsById = new Map(remoteLocations.map((location) => [location.id, location]))

      // Mapea usuarios remotos y rellena companyId vacío desde la DB local
      const rawRemoteUsers = usersRows.map((row) => mapUserRow(row, positionsById))
      const remoteUsersFixed = rawRemoteUsers.map((u) => {
        if (u.companyId) return u
        const localUser = localDb.users.find((lu) => lu.id === u.id)
        return localUser?.companyId ? { ...u, companyId: localUser.companyId } : u
      })

      const users = mergeRemoteUsersWithLocalFields(localDb.users, remoteUsersFixed)
      const usersById = new Map(users.map((user) => [user.id, user]))
      // Mapa de compañía por usuario desde la DB local (fuente de verdad para companyId)
      const localUsersById = new Map(localDb.users.map((u) => [u.id, u]))

      const turns = mergeRemoteTurnsWithLocalFields(localDb.turns, turnsRows.map(mapTurnRow)).map((turn) => {
        const assignedUser = turn.assignedToUserId ? usersById.get(turn.assignedToUserId) : undefined
        const localAssignedUser = turn.assignedToUserId ? localUsersById.get(turn.assignedToUserId) : undefined
        const location = turn.locationId ? locationsById.get(turn.locationId) : undefined
        const companyId =
          turn.companyId ||
          assignedUser?.companyId ||
          localAssignedUser?.companyId ||   // fallback a DB local
          location?.companyId ||
          ''

        return {
          ...turn,
          companyId,
          assignedToUserName: assignedUser?.nombreCompleto ?? turn.assignedToUserName,
          locationNombre: location?.nombre ?? turn.locationNombre,
        }
      })

      return {
        companies: mergeRemoteSimpleFields(localDb.companies, companiesRows.map(mapCompanyRow)),
        users,
        positions: mergeRemotePositionsWithLocalFields(localDb.positions, remotePositions),
        locations: mergeRemoteSimpleFields(localDb.locations, remoteLocations),
        turns,
        userInvitations: localDb.userInvitations,
      }
    }
  } catch (error) {
    console.warn(
      '[database] No fue posible leer Apps Script. Se usa almacenamiento local.',
      error,
    )
  }

  return localDb
}

export async function writeDatabase(data: DatabaseSchema) {
  await writeLocalDatabase(data)
}

export async function createUserInvitation(
  invitation: Omit<UserInvitation, 'id' | 'token' | 'status' | 'createdAt'>,
) {
  const invitationWithId: UserInvitation = {
    id: `invite-${Date.now()}`,
    token: nanoid(24),
    status: 'pendiente',
    createdAt: new Date().toISOString(),
    ...invitation,
  }

  await persistLocalInvitation(invitationWithId)
  return invitationWithId
}

export async function updateUserInvitation(invitation: UserInvitation) {
  await persistLocalInvitation(invitation)
  return invitation
}

export async function findUserInvitationByToken(token: string) {
  const db = await readLocalDatabase()
  return db.userInvitations.find((invitation) => invitation.token === token) ?? null
}

export async function createCompany(company: Omit<Company, 'id'>) {
  let companyWithId: Company = {
    id: `company-${Date.now()}`,
    ...company,
  }

  try {
    const response = await postAppsScript('create', 'companias', companyToRemoteRow(companyWithId))
    const row = pickMutationRow(response)

    if (row) {
      companyWithId = {
        ...mapCompanyRow(row),
        ...companyWithId,
      }
    }
  } catch (error) {
    console.warn(
      '[database] No fue posible crear la compania en Apps Script. Se conserva almacenamiento local.',
      error,
    )
  }

  await persistLocalCompany(companyWithId)
  return companyWithId
}

export async function createUser(user: Omit<User, 'id'>) {
  let userWithId: User = {
    id: `user-${Date.now()}`,
    biometric: normalizeUserBiometricProfile(user as User),
    ...user,
  }

  try {
    const response = await postAppsScript('create', 'usuarios', userToRemoteRow(userWithId))
    const row = pickMutationRow(response)

    if (row) {
      userWithId = {
        ...mapUserRow(row),
        ...userWithId,
      }
    }
  } catch (error) {
    console.warn(
      '[database] No fue posible crear el usuario en Apps Script. Se usa almacenamiento local.',
      error,
    )
  }

  await persistLocalUser(userWithId)
  return userWithId
}

export async function updateUser(user: User) {
  const normalizedUser: User = {
    ...user,
    biometric: normalizeUserBiometricProfile(user),
  }

  await persistLocalUser(normalizedUser)
  return normalizedUser
}

/**
 * Igual que updateUser pero lee y escribe SOLO la DB local, sin consultar Apps Script.
 * Usar en operaciones críticas como registro/verificación biométrica para evitar
 * race conditions con el sync remoto y garantizar que el dato se persiste de inmediato.
 */
export async function updateUserLocal(user: User) {
  const normalizedUser: User = {
    ...user,
    biometric: normalizeUserBiometricProfile(user),
  }
  await persistLocalUser(normalizedUser)
  return normalizedUser
}

/**
 * Lee un usuario directamente de la DB local (sin consultar Apps Script).
 * Usar cuando se necesita el dato más reciente guardado localmente.
 */
export async function readLocalUser(userId: string): Promise<User | null> {
  const db = await readLocalDatabase()
  return db.users.find((u) => u.id === userId) ?? null
}

export async function createPosition(position: Omit<Position, 'id'>) {
  let positionWithId: Position = {
    id: `position-${Date.now()}`,
    ...position,
    permissions: position.permissions?.length ? position.permissions : defaultPositionPermissions,
  }

  try {
    const response = await postAppsScript('create', 'cargos', positionToRemoteRow(positionWithId))
    const row = pickMutationRow(response)

    if (row) {
      positionWithId = {
        ...mapPositionRow(row),
        ...positionWithId,
      }
    }
  } catch (error) {
    console.warn(
      '[database] No fue posible crear el cargo en Apps Script. Se usa almacenamiento local.',
      error,
    )
  }

  await persistLocalPosition(positionWithId)
  return positionWithId
}

export async function updatePosition(position: Position) {
  try {
    await postAppsScript('update', 'cargos', positionToRemoteRow(position))
  } catch (error) {
    console.warn(
      '[database] No fue posible actualizar el cargo en Apps Script. Se usa almacenamiento local.',
      error,
    )
  }

  await persistLocalPosition(position)
  return position
}

export async function createLocation(location: Omit<Location, 'id'>) {
  let locationWithId: Location = {
    id: `location-${Date.now()}`,
    ...location,
  }

  try {
    const response = await postAppsScript('create', 'ubicaciones', locationToRemoteRow(locationWithId))
    const row = pickMutationRow(response)

    if (row) {
      locationWithId = {
        ...mapLocationRow(row),
        ...locationWithId,
      }
    }
  } catch (error) {
    console.warn(
      '[database] No fue posible crear la ubicacion en Apps Script. Se usa almacenamiento local.',
      error,
    )
  }

  await persistLocalLocation(locationWithId)
  return locationWithId
}

export async function createTurn(turn: Omit<Turn, 'id'>) {
  let turnWithId: Turn = {
    id: `turn-${Date.now()}`,
    ...turn,
  }

  try {
    const response = await postAppsScript('create', 'asignaciones', turnToRemoteRow(turnWithId))
    const row = pickMutationRow(response)

    if (row) {
      turnWithId = {
        ...mapTurnRow(row),
        ...turnWithId,
      }
    }
  } catch (error) {
    console.warn(
      '[database] No fue posible crear la asignacion en Apps Script. Se usa almacenamiento local.',
      error,
    )
  }

  await persistLocalTurn(turnWithId)
  return turnWithId
}

export async function updateTurn(turn: Turn) {
  try {
    await postAppsScript('update', 'asignaciones', turnToRemoteRow(turn))
  } catch (error) {
    console.warn(
      '[database] No fue posible actualizar la asignacion en Apps Script. Se usa almacenamiento local.',
      error,
    )
  }

  await persistLocalTurn(turn)
  return turn
}

export async function uploadFacialPhoto(params: {
  userId: string
  userName: string
  turnId: string
  action: 'entrada' | 'salida'
  imageBase64: string
  mimeType?: string
}): Promise<string | null> {
  const ext = (params.mimeType ?? 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `${params.action}_${params.turnId}_${timestamp}.${ext}`

  // Normaliza el nombre del empleado para usarlo como nombre de carpeta
  const safeName = params.userName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // quita tildes
    .replace(/[^a-zA-Z0-9\s_-]/g, '')  // quita caracteres especiales
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase()
    || params.userId

  const photoDir = path.resolve(process.cwd(), 'data', 'fotos', safeName)
  const filePath = path.join(photoDir, fileName)

  // Guarda la imagen localmente (siempre, no bloquea el flujo si falla)
  let localPath: string | null = null
  try {
    await mkdir(photoDir, { recursive: true })
    await writeFile(filePath, Buffer.from(params.imageBase64, 'base64'))
    localPath = filePath
    console.log(`[facial] Foto guardada en: ${filePath}`)
  } catch (localError) {
    console.warn('[facial] No fue posible guardar la foto localmente.', localError)
  }

  // Intenta subir también a Drive (secundario, no bloquea)
  try {
    if (remoteDatabaseUrl) {
      const response = await fetch(remoteDatabaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: 'uploadFacialPhoto',
          table: 'asignaciones',
          payload: {
            userId:      params.userId,
            userName:    params.userName,
            turnId:      params.turnId,
            action:      params.action,
            imageBase64: params.imageBase64,
            mimeType:    params.mimeType ?? 'image/jpeg',
          },
        }),
      })

      if (response.ok) {
        const body = (await response.json()) as { success?: boolean; data?: { url?: string } }
        if (body.success && body.data?.url) {
          return body.data.url
        }
      }
    }
  } catch (driveError) {
    console.warn('[facial] No fue posible subir la foto a Drive.', driveError)
  }

  // Retorna la ruta local relativa si Drive no estuvo disponible
  return localPath ? `data/fotos/${safeName}/${fileName}` : null
}

export async function deleteTurn(turnId: string) {
  try {
    await postAppsScript('delete', 'asignaciones', { id_asignacion: turnId })
  } catch (error) {
    console.warn(
      '[database] No fue posible eliminar la asignacion en Apps Script. Se usa almacenamiento local.',
      error,
    )
  }

  const db = await readLocalDatabase()
  db.turns = db.turns.filter((t) => t.id !== turnId)
  await writeLocalDatabase(db)
}

export async function updateLocation(location: Location) {
  try {
    await postAppsScript('update', 'ubicaciones', locationToRemoteRow(location))
  } catch (error) {
    console.warn(
      '[database] No fue posible actualizar la ubicacion en Apps Script. Se usa almacenamiento local.',
      error,
    )
  }

  await persistLocalLocation(location)
  return location
}

export async function deleteLocation(locationId: string, companyId: string) {
  try {
    await postAppsScript('delete', 'ubicaciones', { id_ubicacion: locationId })
  } catch (error) {
    console.warn(
      '[database] No fue posible eliminar la ubicacion en Apps Script. Se usa almacenamiento local.',
      error,
    )
  }

  const db = await readLocalDatabase()
  db.locations = db.locations.filter(
    (loc) => !(loc.id === locationId && loc.companyId === companyId),
  )
  await writeLocalDatabase(db)
}
