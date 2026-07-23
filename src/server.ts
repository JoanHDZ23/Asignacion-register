import { app } from './app.js'
import { runAutoCloseShifts } from './jobs/autoCloseShifts.js'

const PORT = Number(process.env.PORT ?? 4000)

app.listen(PORT, () => {
  console.log(`Backend de Ommex escuchando en http://localhost:${PORT}`)

  // Ejecuta auto-cierre y auto-rechazo cada 10 minutos
  const INTERVAL_MS = 10 * 60 * 1000
  void runAutoCloseShifts()
  setInterval(() => void runAutoCloseShifts(), INTERVAL_MS)
  console.log(`[auto-close] Job programado cada ${INTERVAL_MS / 60000} minutos.`)
})
