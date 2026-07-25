import cors from 'cors'
import express from 'express'
import swaggerUi from 'swagger-ui-express'
import { openApiDocument } from './lib/openapi.js'
import { requireActiveCompany } from './middleware/auth.js'
import { authRouter } from './routes/auth.js'
import { attendanceRouter } from './routes/attendance.js'
import { companiesRouter } from './routes/companies.js'
import { groupsRouter } from './routes/groups.js'
import { locationsRouter } from './routes/locations.js'
import { messagesRouter } from './routes/messages.js'
import { operationsRouter } from './routes/operations.js'
import { positionsRouter } from './routes/positions.js'
import { settingsRouter } from './routes/settings.js'
import { turnsRouter } from './routes/turns.js'
import { rootRouter } from './routes/root.js'
import { usersRouter } from './routes/users.js'

export const app = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/health/db', async (_request, response) => {
  try {
    const { connectMongo } = await import('./lib/mongodb.js')
    const db = await connectMongo()
    await db.command({ ping: 1 })
    response.json({ status: 'connected', db: process.env.MONGODB_DB_NAME ?? 'ommex_register' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    response.status(503).json({ 
      status: 'disconnected', 
      error: message,
      hint: message.includes('SSL') || message.includes('tlsv1')
        ? 'MongoDB Atlas rechaza la conexión. Agrega 0.0.0.0/0 en Network Access de Atlas.'
        : 'Verifica MONGODB_URI y la configuración de red.'
    })
  }
})

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))

app.use('/api/auth', authRouter)
app.use('/api/root', rootRouter)
app.use('/api/attendance', requireActiveCompany, attendanceRouter)
app.use('/api/companies', requireActiveCompany, companiesRouter)
app.use('/api/groups', requireActiveCompany, groupsRouter)
app.use('/api/locations', requireActiveCompany, locationsRouter)
app.use('/api/messages', requireActiveCompany, messagesRouter)
app.use('/api/operations', requireActiveCompany, operationsRouter)
app.use('/api/positions', requireActiveCompany, positionsRouter)
app.use('/api/settings', requireActiveCompany, settingsRouter)
app.use('/api/users', requireActiveCompany, usersRouter)
app.use('/api/turns', requireActiveCompany, turnsRouter)

app.use(
  (
    error: Error,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('[error-handler]', error.message)

    // Error de conexión a MongoDB
    if (
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('Server selection timed out') ||
      error.message.includes('connect ETIMEDOUT') ||
      error.message.includes('MongoServerSelectionError')
    ) {
      response.status(503).json({
        message: 'Base de datos no disponible. Verifica la conexión a MongoDB Atlas.',
        detail: error.message,
      })
      return
    }

    response.status(500).json({
      message: 'Error interno del servidor.',
      detail: error.message,
    })
  },
)
