import cors from 'cors'
import express from 'express'
import swaggerUi from 'swagger-ui-express'
import { openApiDocument } from './lib/openapi.js'
import { authRouter } from './routes/auth.js'
import { attendanceRouter } from './routes/attendance.js'
import { companiesRouter } from './routes/companies.js'
import { locationsRouter } from './routes/locations.js'
import { messagesRouter } from './routes/messages.js'
import { positionsRouter } from './routes/positions.js'
import { turnsRouter } from './routes/turns.js'
import { usersRouter } from './routes/users.js'

export const app = express()

app.use(cors())
app.use(express.json())

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument))

app.use('/api/auth', authRouter)
app.use('/api/attendance', attendanceRouter)
app.use('/api/companies', companiesRouter)
app.use('/api/locations', locationsRouter)
app.use('/api/messages', messagesRouter)
app.use('/api/positions', positionsRouter)
app.use('/api/users', usersRouter)
app.use('/api/turns', turnsRouter)

app.use(
  (
    error: Error,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({
      message: 'Error interno del servidor.',
      detail: error.message,
    })
  },
)
