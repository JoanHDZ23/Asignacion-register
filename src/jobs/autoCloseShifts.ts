/**
 * Job automático que se ejecuta periódicamente para:
 * 1. Auto-cerrar turnos sin salida marcada (30 min después de horaFin)
 * 2. Auto-rechazar turnos no confirmados antes de su deadline
 * 3. Eliminar invitaciones expiradas (más de 1 hora)
 */
import { readDatabase, registerHorasTurno, updateTurn } from '../lib/database.js'
import { getUserInvitationsCollection } from '../lib/mongodb.js'
import type { AttendanceRecord, Turn } from '../types.js'

const AUTO_CLOSE_GRACE_MINUTES = 30

function buildAutoCheckOut(turn: Turn): AttendanceRecord | null {
  if (!turn.horaFin || !turn.fecha) return null

  // Calcula la hora de fin (soporta turnos nocturnos)
  const [sh, sm] = turn.hora.split(':').map(Number)
  const [eh, em] = turn.horaFin.split(':').map(Number)
  if (Number.isNaN(eh) || Number.isNaN(em)) return null

  let endMs = new Date(`${turn.fecha}T${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`).getTime()
  const startMs = new Date(`${turn.fecha}T${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}:00`).getTime()
  if (endMs <= startMs) endMs += 24 * 3_600_000 // nocturno

  return {
    action: 'salida',
    markedAt: new Date(endMs).toISOString(),
    method: 'auto',
    credentialId: 'system',
    locationCheck: {
      latitude: 0,
      longitude: 0,
      distanceMeters: 0,
      allowedRadiusMeters: 0,
      withinRange: true,
      locationId: turn.locationId ?? '',
      locationNombre: turn.locationNombre,
      verifiedAt: new Date(endMs).toISOString(),
    },
  }
}

export async function runAutoCloseShifts() {
  const now = Date.now()
  const db = await readDatabase()
  let closedCount = 0
  let rejectedCount = 0

  for (const turn of db.turns) {
    // ── Auto-cierre: turnos confirmados con checkIn pero sin checkOut, 30 min después de horaFin
    if (
      (turn.estado === 'confirmado' || turn.estado === 'en_proceso') &&
      turn.attendance?.checkIn &&
      !turn.attendance?.checkOut &&
      turn.horaFin &&
      turn.fecha
    ) {
      const [eh, em] = turn.horaFin.split(':').map(Number)
      const [sh, sm] = turn.hora.split(':').map(Number)
      if (!Number.isNaN(eh) && !Number.isNaN(em)) {
        let endMs = new Date(`${turn.fecha}T${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`).getTime()
        const startMs = new Date(`${turn.fecha}T${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}:00`).getTime()
        if (endMs <= startMs) endMs += 24 * 3_600_000

        const graceEnd = endMs + AUTO_CLOSE_GRACE_MINUTES * 60_000

        if (now >= graceEnd) {
          const autoCheckOut = buildAutoCheckOut(turn)
          if (autoCheckOut) {
            turn.attendance = { ...turn.attendance, checkOut: autoCheckOut }
            turn.estado = 'finalizado'
            turn.updatedAt = new Date().toISOString()
            await updateTurn(turn)
            // Registra las horas trabajadas
            const assignedUser = db.users.find((u) => u.id === turn.assignedToUserId)
            await registerHorasTurno({
              turn,
              userName: assignedUser?.nombreCompleto ?? turn.assignedToUserName ?? '',
              cargo: assignedUser?.cargo ?? '',
              locationNombre: turn.locationNombre,
            })
            closedCount++
          }
        }
      }
    }

    // ── Auto-rechazo: turnos asignados cuyo deadline ya pasó sin confirmación
    // NOTA: Deshabilitado — el empleado puede marcar entrada sin importar el deadline.
    // El deadline es solo informativo. El auto-close por horaFin sigue activo.
  }

  if (closedCount > 0 || rejectedCount > 0) {
    console.log(`[auto-close] ${closedCount} turno(s) cerrado(s) automáticamente, ${rejectedCount} rechazado(s) por vencimiento.`)
  }

  // ── Eliminar invitaciones expiradas (pendientes que ya pasaron de 1 hora)
  try {
    const invCol = await getUserInvitationsCollection()
    const nowISO = new Date().toISOString()
    const deleteResult = await invCol.deleteMany({
      status: 'pendiente',
      expiresAt: { $lt: nowISO },
    })
    if (deleteResult.deletedCount > 0) {
      console.log(`[auto-close] ${deleteResult.deletedCount} invitación(es) expirada(s) eliminada(s).`)
    }
  } catch (err) {
    // No bloquea el job si falla la limpieza
    console.warn('[auto-close] Error limpiando invitaciones:', err)
  }
}
