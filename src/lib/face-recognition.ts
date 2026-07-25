/**
 * Face Recognition client — calls the DeepFace Python microservice
 */

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL ?? ''

export interface FaceVerifyResult {
  verified: boolean
  distance?: number
  threshold?: number
  message?: string
  error?: string
  code?: string
}

/**
 * Register a user's face for future verification.
 */
export async function registerFace(userId: string, imageBase64: string): Promise<{ success: boolean; error?: string }> {
  if (!FACE_SERVICE_URL) return { success: true } // Skip if service not configured

  try {
    const response = await fetch(`${FACE_SERVICE_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, imageBase64 }),
    })

    const data = await response.json() as { success?: boolean; error?: string }

    if (!response.ok) {
      return { success: false, error: data.error ?? 'Error al registrar rostro' }
    }

    return { success: true }
  } catch (error) {
    console.warn('[face-recognition] Servicio no disponible para registro:', (error as Error).message)
    return { success: true } // Don't block if service is down
  }
}

/**
 * Verify a face against the registered reference.
 * Returns verified=true if the face matches, or if the service is unavailable (graceful degradation).
 */
export async function verifyFace(userId: string, imageBase64: string): Promise<FaceVerifyResult> {
  if (!FACE_SERVICE_URL) return { verified: true, message: 'Servicio facial no configurado — bypass' }

  try {
    const response = await fetch(`${FACE_SERVICE_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, imageBase64 }),
    })

    const data = await response.json() as FaceVerifyResult

    if (!response.ok) {
      // If no face registered, let them through (first time)
      if (data.code === 'NO_FACE_REGISTERED') {
        return { verified: true, message: 'Sin rostro registrado — se omite verificación' }
      }
      // If face not detected in image
      if (data.code === 'NO_FACE_DETECTED') {
        return { verified: false, message: data.error ?? 'No se detectó rostro en la imagen' }
      }
      return { verified: false, error: data.error }
    }

    return data
  } catch (error) {
    console.warn('[face-recognition] Servicio no disponible:', (error as Error).message)
    // Graceful degradation: if service is down, allow entry
    return { verified: true, message: 'Servicio facial no disponible — verificación omitida' }
  }
}

/**
 * Check if the face service is available.
 */
export async function isFaceServiceAvailable(): Promise<boolean> {
  if (!FACE_SERVICE_URL) return false
  try {
    const response = await fetch(`${FACE_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) })
    return response.ok
  } catch {
    return false
  }
}
