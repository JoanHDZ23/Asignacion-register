import { app } from './app.js'
import { connectMongo } from './lib/mongodb.js'
import { runAutoCloseShifts } from './jobs/autoCloseShifts.js'

const PORT = Number(process.env.PORT ?? 4000)

async function startServer() {
  app.listen(PORT, () => {
    console.log(`Backend de Ommex escuchando en http://localhost:${PORT}`)
  })

  // Conecta a MongoDB Atlas (reintentos automáticos en cada request si falla aquí)
  try {
    await connectMongo()
    console.log('[server] MongoDB conectado exitosamente al inicio.')
  } catch (error) {
    console.warn('[server] MongoDB no disponible al inicio — se reintentará en cada request.', (error as Error).message)
  }

  // Ejecuta auto-cierre y auto-rechazo cada 10 minutos
  const INTERVAL_MS = 10 * 60 * 1000
  void runAutoCloseShifts().catch(() => {})
  setInterval(() => void runAutoCloseShifts().catch(() => {}), INTERVAL_MS)
  console.log(`[auto-close] Job programado cada ${INTERVAL_MS / 60000} minutos.`)
}

startServer().catch((err) => {
  console.error('[server] Error fatal al iniciar:', err)
  process.exit(1)
})
