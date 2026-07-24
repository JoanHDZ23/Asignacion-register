import { MongoClient, type Db, type Collection } from 'mongodb'
import type {
  Company,
  Factura,
  HorasTurnoRecord,
  Location,
  OperationGroup,
  Position,
  Turn,
  User,
  UserInvitation,
} from '../types.js'

const MONGODB_URI = process.env.MONGODB_URI ??
  'mongodb+srv://tianhernandez2310_db_user:mEWzcJAm5kxWTsYL@cluster0.s52qrn3.mongodb.net/?appName=Cluster0'

const DB_NAME = process.env.MONGODB_DB_NAME ?? 'ommex_register'

let client: MongoClient | null = null
let db: Db | null = null
let connecting: Promise<Db> | null = null

/**
 * Conecta a MongoDB Atlas y devuelve la instancia de la DB.
 * Reutiliza la conexión si ya existe. Serializa intentos concurrentes.
 */
export async function connectMongo(): Promise<Db> {
  if (db) return db

  // Evita múltiples intentos de conexión simultáneos
  if (connecting) return connecting

  connecting = (async () => {
    try {
      client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      })
      await client.connect()
      db = client.db(DB_NAME)
      console.log(`[MongoDB] Conectado a ${DB_NAME}`)

      // Crea índices para optimizar consultas frecuentes
      await createIndexes(db)

      return db
    } catch (error) {
      console.error('[MongoDB] Error de conexión:', error)
      // Reset para permitir reintentos
      client = null
      db = null
      throw error
    } finally {
      connecting = null
    }
  })()

  return connecting
}

/**
 * Crea índices para las colecciones principales.
 */
async function createIndexes(database: Db) {
  try {
    await database.collection('companies').createIndex({ nit: 1 }, { unique: true, sparse: true })
    await database.collection('users').createIndex({ companyId: 1 })
    await database.collection('users').createIndex({ numeroDocumento: 1 }, { unique: true, sparse: true })
    await database.collection('users').createIndex({ correo: 1 }, { sparse: true })
    await database.collection('positions').createIndex({ companyId: 1 })
    await database.collection('locations').createIndex({ companyId: 1 })
    await database.collection('turns').createIndex({ companyId: 1, fecha: 1 })
    await database.collection('turns').createIndex({ assignedToUserId: 1, fecha: 1 })
    await database.collection('turns').createIndex({ locationId: 1, fecha: 1 })
    await database.collection('horasTurno').createIndex({ companyId: 1, fecha: 1 })
    await database.collection('horasTurno').createIndex({ userId: 1 })
    await database.collection('facturas').createIndex({ companyId: 1, periodoMes: 1 })
    await database.collection('groups').createIndex({ companyId: 1 })
    await database.collection('userInvitations').createIndex({ token: 1 }, { unique: true })
    console.log('[MongoDB] Índices creados/verificados')
  } catch (error) {
    console.warn('[MongoDB] Error creando índices (no crítico):', error)
  }
}

// ── Colecciones tipadas ──────────────────────────────────────────────────

export function getCompaniesCollection(): Promise<Collection<Company>> {
  return connectMongo().then((d) => d.collection<Company>('companies'))
}

export function getUsersCollection(): Promise<Collection<User>> {
  return connectMongo().then((d) => d.collection<User>('users'))
}

export function getPositionsCollection(): Promise<Collection<Position>> {
  return connectMongo().then((d) => d.collection<Position>('positions'))
}

export function getLocationsCollection(): Promise<Collection<Location>> {
  return connectMongo().then((d) => d.collection<Location>('locations'))
}

export function getTurnsCollection(): Promise<Collection<Turn>> {
  return connectMongo().then((d) => d.collection<Turn>('turns'))
}

export function getUserInvitationsCollection(): Promise<Collection<UserInvitation>> {
  return connectMongo().then((d) => d.collection<UserInvitation>('userInvitations'))
}

export function getHorasTurnoCollection(): Promise<Collection<HorasTurnoRecord>> {
  return connectMongo().then((d) => d.collection<HorasTurnoRecord>('horasTurno'))
}

export function getFacturasCollection(): Promise<Collection<Factura>> {
  return connectMongo().then((d) => d.collection<Factura>('facturas'))
}

export function getGroupsCollection(): Promise<Collection<OperationGroup>> {
  return connectMongo().then((d) => d.collection<OperationGroup>('groups'))
}

/**
 * Cierra la conexión (para graceful shutdown).
 */
export async function closeMongo() {
  if (client) {
    await client.close()
    client = null
    db = null
    console.log('[MongoDB] Conexión cerrada')
  }
}
