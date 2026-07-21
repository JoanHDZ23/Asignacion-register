import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server'
import { Router } from 'express'
import { readDatabase, readLocalUser, updateTurn, updateUser, updateUserLocal, uploadFacialPhoto } from '../lib/database.js'
import { requireAuth } from '../middleware/auth.js'
import type {
  AttendanceAction,
  AttendanceLocationCheck,
  AttendanceRecord,
  Location,
  StoredWebAuthnCredential,
  Turn,
  User,
} from '../types.js'

const attendanceRouter = Router()

const rpName = process.env.WEBAUTHN_RP_NAME ?? 'Ommex Turnos'
const rpID = process.env.WEBAUTHN_RP_ID ?? 'localhost'
const expectedOrigins = (process.env.WEBAUTHN_EXPECTED_ORIGINS ??
  'http://localhost:5173,http://localhost:4173,http://localhost:3000').split(',').map((item) =>
  item.trim(),
)

function resolveCurrentUser(dbUsers: User[], userId: string) {
  return dbUsers.find((item) => item.id === userId) ?? null
}

function resolveCurrentCompanyId(user: User | null, authCompanyId: string) {
  return authCompanyId || user?.companyId || ''
}

function parseAttendanceAction(value: unknown): AttendanceAction | null {
  return value === 'entrada' || value === 'salida' ? value : null
}

/** Devuelve true si el usuario es supervisor (por rol o por cargo). */
function isSupervisorUser(user: User): boolean {
  return user.role === 'supervisor'
    || (user.role !== 'admin' && Boolean(user.cargo?.toLowerCase().includes('supervisor')))
}

function toStoredCredential(credential: WebAuthnCredential): StoredWebAuthnCredential {
  return {
    id: credential.id,
    publicKey: Array.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
    createdAt: new Date().toISOString(),
  }
}

function toWebAuthnCredential(credential: StoredWebAuthnCredential): WebAuthnCredential {
  return {
    id: credential.id,
    publicKey: new Uint8Array(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports as WebAuthnCredential['transports'],
  }
}

function encodeUserId(userId: string) {
  return new TextEncoder().encode(userId)
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180
}

function calculateDistanceMeters(
  originLatitude: number,
  originLongitude: number,
  targetLatitude: number,
  targetLongitude: number,
) {
  const earthRadius = 6371000
  const deltaLatitude = degreesToRadians(targetLatitude - originLatitude)
  const deltaLongitude = degreesToRadians(targetLongitude - originLongitude)
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(degreesToRadians(originLatitude)) *
      Math.cos(degreesToRadians(targetLatitude)) *
      Math.sin(deltaLongitude / 2) ** 2

  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function parseCoordinate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function buildLocationCheck(
  location: Location,
  latitude: number,
  longitude: number,
): AttendanceLocationCheck | null {
  const expectedLatitude = parseCoordinate(location.latitud)
  const expectedLongitude = parseCoordinate(location.longitud)

  if (expectedLatitude === null || expectedLongitude === null) {
    return null
  }

  const allowedRadiusMeters = Number(location.radioTolerancia ?? 100)
  const distanceMeters = calculateDistanceMeters(
    expectedLatitude,
    expectedLongitude,
    latitude,
    longitude,
  )

  return {
    latitude,
    longitude,
    distanceMeters: Number(distanceMeters.toFixed(2)),
    allowedRadiusMeters: Number.isFinite(allowedRadiusMeters) ? allowedRadiusMeters : 100,
    withinRange: distanceMeters <= (Number.isFinite(allowedRadiusMeters) ? allowedRadiusMeters : 100),
    locationId: location.id,
    locationNombre: location.nombre,
    verifiedAt: new Date().toISOString(),
  }
}

function findAssignedTurn(
  turns: Turn[],
  companyId: string,
  userId: string,
  turnId: string,
) {
  return (
    turns.find(
      (item) =>
        item.id === turnId &&
        item.companyId === companyId &&
        item.assignedToUserId === userId,
    ) ?? null
  )
}

attendanceRouter.use(requireAuth)

attendanceRouter.get('/biometric-status', async (request, response) => {
  // Lee directo de local para no bloquear con Apps Script
  const user = await readLocalUser(request.authUser!.userId)

  if (!user) {
    response.status(404).json({ message: 'Usuario no encontrado.' })
    return
  }

  response.json({
    biometricConfigured: Boolean(user.biometric?.credentials.length),
    credentialCount: user.biometric?.credentials.length ?? 0,
  })
})

attendanceRouter.post('/generate-registration-options', async (request, response) => {
  // Usa DB local para evitar race conditions con Apps Script
  const user = await readLocalUser(request.authUser!.userId)

  if (!user) {
    // Si no está en local aún, intenta con la DB completa (primer login)
    const db = await readDatabase()
    const remoteUser = resolveCurrentUser(db.users, request.authUser!.userId)
    if (!remoteUser) {
      response.status(404).json({ message: 'Usuario no encontrado.' })
      return
    }
    // Persiste el usuario en local antes de continuar
    await updateUserLocal(remoteUser)
  }

  const localUser = (await readLocalUser(request.authUser!.userId))!

  // Detecta el rpID desde el Origin del request
  const requestOrigin = request.headers.origin ?? ''
  let effectiveRpId = rpID
  try {
    if (requestOrigin) {
      const url = new URL(requestOrigin)
      effectiveRpId = url.hostname
    }
  } catch { /* usa el rpID configurado */ }

  const options = await generateRegistrationOptions({
    rpName,
    rpID: effectiveRpId,
    userID: encodeUserId(localUser.id),
    userName: localUser.numeroDocumento || localUser.correo || localUser.id,
    userDisplayName: localUser.nombreCompleto,
    timeout: 60000,
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    excludeCredentials:
      localUser.biometric?.credentials.map((credential) => ({
        id: credential.id,
        transports: credential.transports as WebAuthnCredential['transports'],
      })) ?? [],
  })

  localUser.biometric = {
    credentials: localUser.biometric?.credentials ?? [],
    registrationChallenge: options.challenge,
    pendingRpId: effectiveRpId,
  }

  await updateUserLocal(localUser)
  console.log(`[register] Challenge generado para ${localUser.nombreCompleto} | rpID: ${effectiveRpId}`)
  response.json(options)
})

attendanceRouter.post('/verify-registration', async (request, response) => {
  const { responseJSON } = request.body as { responseJSON?: RegistrationResponseJSON }

  // Lee SOLO desde local — el challenge fue guardado ahí en generate-registration-options
  const user = await readLocalUser(request.authUser!.userId)

  if (!user) {
    response.status(404).json({ message: 'Usuario no encontrado.' })
    return
  }

  if (!responseJSON || !user.biometric?.registrationChallenge) {
    response.status(400).json({ message: 'No hay un registro biometrico pendiente. Haz clic en "Registrar biometria" primero.' })
    return
  }

  const effectiveRpId = user.biometric.pendingRpId ?? rpID

  let browserOrigin: string | undefined
  try {
    const clientDataRaw = (responseJSON as { response?: { clientDataJSON?: string } }).response?.clientDataJSON
    if (clientDataRaw) {
      const decoded = JSON.parse(Buffer.from(clientDataRaw, 'base64').toString('utf8')) as { origin?: string; type?: string }
      browserOrigin = decoded.origin
    }
  } catch { /* no crítico */ }

  const originsToCheck = browserOrigin && !expectedOrigins.includes(browserOrigin)
    ? [...expectedOrigins, browserOrigin]
    : expectedOrigins

  console.log(`[register] Verificando | rpID: ${effectiveRpId} | origin browser: ${browserOrigin} | origins aceptados: ${originsToCheck.join(', ')}`)

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>

  try {
    verification = await verifyRegistrationResponse({
      response: responseJSON,
      expectedChallenge: user.biometric.registrationChallenge,
      expectedOrigin: originsToCheck,
      expectedRPID: effectiveRpId,
      requireUserVerification: false,
    })
  } catch (verifyError) {
    console.error('[register] Error al verificar:', verifyError)
    response.status(400).json({
      message: `No fue posible verificar la credencial biometrica: ${verifyError instanceof Error ? verifyError.message : 'error desconocido'}`,
    })
    return
  }

  if (!verification.verified || !verification.registrationInfo) {
    response.status(400).json({ message: 'No fue posible verificar la credencial biometrica.' })
    return
  }

  const nextCredential = toStoredCredential(verification.registrationInfo.credential)
  const currentCredentials = (user.biometric.credentials ?? []).filter((item) => item.id !== nextCredential.id)

  user.biometric = {
    credentials: [...currentCredentials, nextCredential],
    pendingRpId: effectiveRpId,  // conserva el rpID para autenticaciones futuras
  }

  await updateUserLocal(user)

  console.log(`[register] ✓ Credencial guardada para ${user.nombreCompleto} | total: ${user.biometric.credentials.length}`)

  response.json({
    verified: true,
    biometricConfigured: true,
    credentialCount: user.biometric.credentials.length,
  })
})

attendanceRouter.post('/generate-authentication-options', async (request, response) => {
  const { turnId, action } = request.body ?? {}
  const parsedAction = parseAttendanceAction(action)

  // Lee usuario desde local (tiene las credenciales guardadas ahí)
  const user = await readLocalUser(request.authUser!.userId)

  if (!user) {
    response.status(404).json({ message: 'Usuario no encontrado.' })
    return
  }

  if (!turnId || !parsedAction) {
    response.status(400).json({ message: 'El turno y la accion de asistencia son requeridos.' })
    return
  }

  if (!user.biometric?.credentials.length) {
    response.status(400).json({ message: 'El usuario aun no ha registrado una credencial biometrica.' })
    return
  }

  // Para buscar el turno necesitamos la DB completa (incluye datos de Apps Script)
  const db = await readDatabase()
  const companyId = user.companyId || resolveCurrentCompanyId(user, request.authUser!.companyId)

  if (!companyId) {
    response.status(404).json({ message: 'No se pudo identificar la compania del usuario.' })
    return
  }

  const turn = findAssignedTurn(db.turns, companyId, user.id, String(turnId))

  if (!turn) {
    const rawTurn = db.turns.find((t) => t.id === String(turnId))
    console.warn('[auth-options] Turno no encontrado.', {
      buscado: turnId, companyId,
      sinFiltro: rawTurn ? { id: rawTurn.id, companyId: rawTurn.companyId, assignedTo: rawTurn.assignedToUserId } : null,
      userId: user.id,
    })
    response.status(404).json({ message: 'El turno asignado no existe o no pertenece a tu usuario.' })
    return
  }

  if (parsedAction === 'salida' && !turn.attendance?.checkIn) {
    response.status(400).json({ message: 'Primero debes registrar la entrada del turno.' })
    return
  }

  // Usa el rpID guardado de cuando se registró la biometría
  const requestOrigin = request.headers.origin ?? ''
  let effectiveRpId = user.biometric.pendingRpId ?? rpID
  try {
    if (requestOrigin) {
      const url = new URL(requestOrigin)
      effectiveRpId = url.hostname
    }
  } catch { /* usa el rpID guardado */ }

  const options = await generateAuthenticationOptions({
    rpID: effectiveRpId,
    timeout: 60000,
    userVerification: 'preferred',
    allowCredentials: user.biometric.credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports as WebAuthnCredential['transports'],
    })),
  })

  user.biometric = {
    ...user.biometric,
    authenticationChallenge: options.challenge,
    pendingTurnId: turn.id,
    pendingAttendanceAction: parsedAction,
    pendingRpId: effectiveRpId,
  }

  await updateUserLocal(user)
  response.json(options)
})

attendanceRouter.post('/verify-authentication', async (request, response) => {
  const { responseJSON, latitude, longitude, photoBase64, photoMimeType } = request.body as {
    responseJSON?: AuthenticationResponseJSON
    latitude?: number
    longitude?: number
    photoBase64?: string
    photoMimeType?: string
  }

  // Lee usuario desde local donde están las credenciales y el challenge pendiente
  const user = await readLocalUser(request.authUser!.userId)

  if (!user) {
    response.status(404).json({ message: 'Usuario no encontrado.' })
    return
  }

  const companyId = user.companyId || request.authUser!.companyId

  if (!companyId) {
    response.status(404).json({ message: 'No se pudo identificar la compania del usuario.' })
    return
  }

  if (
    !responseJSON ||
    !user.biometric?.authenticationChallenge ||
    !user.biometric.pendingTurnId ||
    !user.biometric.pendingAttendanceAction
  ) {
    response.status(400).json({ message: 'No hay una verificacion biometrica pendiente.' })
    return
  }

  const credential = user.biometric.credentials.find((item) => item.id === responseJSON.id)

  if (!credential) {
    response.status(404).json({ message: 'La credencial biometrica utilizada no pertenece al usuario.' })
    return
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>

  try {
    // Detecta el origin real del browser desde clientDataJSON
    let browserOrigin: string | undefined
    try {
      const clientDataRaw = (responseJSON as { response?: { clientDataJSON?: string } }).response?.clientDataJSON
      if (clientDataRaw) {
        const decoded = JSON.parse(Buffer.from(clientDataRaw, 'base64').toString('utf8')) as { origin?: string }
        browserOrigin = decoded.origin
      }
    } catch { /* no crítico */ }

    const originsToCheck = browserOrigin && !expectedOrigins.includes(browserOrigin)
      ? [...expectedOrigins, browserOrigin]
      : expectedOrigins

    // Usa el rpID con el que se generó el challenge de autenticación
    const effectiveRpId = user.biometric.pendingRpId ?? rpID

    verification = await verifyAuthenticationResponse({
      response: responseJSON,
      expectedChallenge: user.biometric.authenticationChallenge,
      expectedOrigin: originsToCheck,
      expectedRPID: effectiveRpId,
      credential: toWebAuthnCredential(credential),
      requireUserVerification: false,
    })
  } catch (verifyError) {
    console.error('[verify-authentication] Error al verificar:', verifyError)
    response.status(400).json({
      message: `La autenticacion biometrica no pudo verificarse: ${verifyError instanceof Error ? verifyError.message : 'error desconocido'}`,
    })
    return
  }

  if (!verification.verified) {
    response.status(400).json({ message: 'La autenticacion biometrica no pudo verificarse.' })
    return
  }

  const parsedLatitude = parseCoordinate(latitude)
  const parsedLongitude = parseCoordinate(longitude)

  if (parsedLatitude === null || parsedLongitude === null) {
    response.status(400).json({ message: 'La geolocalizacion actual es requerida para registrar asistencia.' })
    return
  }

  // Carga el turno y la ubicación desde la DB completa (incluye Apps Script)
  const db = await readDatabase()
  const turn = findAssignedTurn(db.turns, companyId, user.id, user.biometric.pendingTurnId)

  if (!turn) {
    response.status(404).json({ message: 'El turno asignado ya no esta disponible.' })
    return
  }

  if (!turn.locationId) {
    response.status(400).json({ message: 'El turno no tiene un punto operativo configurado.' })
    return
  }

  const location = db.locations.find(
    (item) => item.id === turn.locationId && item.companyId === companyId,
  )

  if (!location) {
    response.status(404).json({ message: 'La ubicacion del turno no existe.' })
    return
  }

  const locationCheck = buildLocationCheck(location, parsedLatitude, parsedLongitude)

  if (!locationCheck) {
    response.status(400).json({
      message: 'La ubicacion del turno no tiene coordenadas validas para verificar asistencia.',
    })
    return
  }

  if (!locationCheck.withinRange) {
    response.status(403).json({
      message: 'Debes encontrarte dentro del radio permitido del punto de trabajo para marcar asistencia.',
      distanceMeters: locationCheck.distanceMeters,
      allowedRadiusMeters: locationCheck.allowedRadiusMeters,
    })
    return
  }

  const action = user.biometric.pendingAttendanceAction

  // Guarda la foto facial localmente y también intenta subir a Drive
  const facialPhotoUrl = photoBase64
    ? await uploadFacialPhoto({
        userId:      user.id,
        userName:    user.nombreCompleto,
        turnId:      turn.id,
        action,
        imageBase64: photoBase64,
        mimeType:    photoMimeType,
      })
    : null

  const attendanceRecord: AttendanceRecord = {
    action,
    markedAt: new Date().toISOString(),
    method: 'webauthn',
    credentialId: credential.id,
    locationCheck,
    ...(facialPhotoUrl ? { facialPhotoUrl } : {}),
  }

  turn.attendance = {
    ...turn.attendance,
    checkIn: action === 'entrada' ? attendanceRecord : turn.attendance?.checkIn,
    checkOut: action === 'salida' ? attendanceRecord : turn.attendance?.checkOut,
  }
  // Supervisores: la entrada queda directamente como 'confirmado'
  if (action === 'entrada') {
    turn.estado = isSupervisorUser(user) ? 'confirmado' : 'en_proceso'
  } else {
    turn.estado = 'finalizado'
  }
  turn.updatedAt = new Date().toISOString()

  // Actualiza el counter de la credencial usada y limpia todos los campos
  // pendientes (challenge, turnId, accion) para evitar estado residual en DB
  user.biometric = {
    credentials: user.biometric.credentials.map((item) =>
      item.id === credential.id
        ? {
            ...item,
            counter: verification.authenticationInfo.newCounter,
            lastUsedAt: new Date().toISOString(),
          }
        : item,
    ),
    pendingRpId: user.biometric.pendingRpId,
    // authenticationChallenge, pendingTurnId y pendingAttendanceAction
    // se omiten deliberadamente para invalidarlos tras el uso exitoso
  }

  await updateTurn(turn)
  await updateUserLocal(user)

  response.json({
    verified: true,
    action,
    turn,
    attendance: attendanceRecord,
  })
})

/**
/**
 * Marca asistencia sin WebAuthn.
 * - ENTRADA: requiere geolocalización dentro del radio del punto.
 * - SALIDA: no requiere validación de ubicación (el empleado puede estar en tránsito).
 */
attendanceRouter.post('/mark', async (request, response) => {
  const { turnId, action, latitude, longitude, photoBase64, photoMimeType } = request.body as {
    turnId?: string
    action?: string
    latitude?: number
    longitude?: number
    photoBase64?: string
    photoMimeType?: string
  }

  const parsedAction = parseAttendanceAction(action)

  if (!turnId || !parsedAction) {
    response.status(400).json({ message: 'El turno y la accion de asistencia son requeridos.' })
    return
  }

  // Para salida la geolocalización es opcional
  const parsedLatitude  = parseCoordinate(latitude)
  const parsedLongitude = parseCoordinate(longitude)

  if (parsedAction === 'entrada' && (parsedLatitude === null || parsedLongitude === null)) {
    response.status(400).json({ message: 'La geolocalizacion actual es requerida para registrar la entrada.' })
    return
  }

  const user = await readLocalUser(request.authUser!.userId)
  if (!user) {
    response.status(404).json({ message: 'Usuario no encontrado.' })
    return
  }

  const companyId = user.companyId || request.authUser!.companyId
  if (!companyId) {
    response.status(404).json({ message: 'No se pudo identificar la compania del usuario.' })
    return
  }

  const db = await readDatabase()
  const turn = findAssignedTurn(db.turns, companyId, user.id, String(turnId))

  if (!turn) {
    response.status(404).json({ message: 'El turno asignado no existe o no pertenece a tu usuario.' })
    return
  }

  if (parsedAction === 'salida' && !turn.attendance?.checkIn) {
    response.status(400).json({ message: 'Primero debes registrar la entrada del turno.' })
    return
  }

  // Para salida: construye un locationCheck pasivo (sin validar radio)
  let locationCheck: ReturnType<typeof buildLocationCheck> = null

  if (parsedLatitude !== null && parsedLongitude !== null && turn.locationId) {
    const location = db.locations.find(
      (item) => item.id === turn.locationId && item.companyId === companyId,
    )
    if (location) {
      locationCheck = buildLocationCheck(location, parsedLatitude, parsedLongitude)
    }
  }

  // Valida radio SOLO en entrada
  if (parsedAction === 'entrada') {
    if (!turn.locationId) {
      response.status(400).json({ message: 'El turno no tiene un punto operativo configurado.' })
      return
    }
    if (!locationCheck) {
      response.status(400).json({ message: 'La ubicacion del turno no tiene coordenadas validas.' })
      return
    }
    if (!locationCheck.withinRange) {
      response.status(403).json({
        message: `Debes encontrarte dentro del radio permitido (${locationCheck.allowedRadiusMeters} m) del punto de trabajo. Distancia actual: ${locationCheck.distanceMeters} m.`,
        distanceMeters: locationCheck.distanceMeters,
        allowedRadiusMeters: locationCheck.allowedRadiusMeters,
      })
      return
    }
  }

  // Si no hay locationCheck para salida, usa un registro mínimo
  const finalLocationCheck: typeof locationCheck = locationCheck ?? {
    latitude:           parsedLatitude  ?? 0,
    longitude:          parsedLongitude ?? 0,
    distanceMeters:     0,
    allowedRadiusMeters: 0,
    withinRange:        true,
    locationId:         turn.locationId ?? '',
    locationNombre:     turn.locationNombre,
    verifiedAt:         new Date().toISOString(),
  }

  const facialPhotoUrl = photoBase64
    ? await uploadFacialPhoto({
        userId:      user.id,
        userName:    user.nombreCompleto,
        turnId:      turn.id,
        action:      parsedAction,
        imageBase64: photoBase64,
        mimeType:    photoMimeType,
      })
    : null

  const attendanceRecord: AttendanceRecord = {
    action: parsedAction,
    markedAt: new Date().toISOString(),
    method: 'pin',
    credentialId: 'none',
    locationCheck: finalLocationCheck,
    ...(facialPhotoUrl ? { facialPhotoUrl } : {}),
  }

  turn.attendance = {
    ...turn.attendance,
    checkIn:  parsedAction === 'entrada' ? attendanceRecord : turn.attendance?.checkIn,
    checkOut: parsedAction === 'salida'  ? attendanceRecord : turn.attendance?.checkOut,
  }
  // Supervisores: la entrada queda directamente como 'confirmado'
  if (parsedAction === 'entrada') {
    turn.estado = isSupervisorUser(user) ? 'confirmado' : 'en_proceso'
  } else {
    turn.estado = 'finalizado'
  }
  turn.updatedAt = new Date().toISOString()

  await updateTurn(turn)

  response.json({
    verified: true,
    action: parsedAction,
    turn,
    attendance: attendanceRecord,
  })
})

export { attendanceRouter }
