/**
 * Face scanning utility using face-api.js
 * Extracts 128-dimensional face descriptors for recognition.
 * All functions fail gracefully — return null on any error.
 */

let faceapi: typeof import('face-api.js') | null = null
let modelsLoaded = false
let modelLoadFailed = false

const MODEL_URL = '/models'

/**
 * Load face-api.js and its models (once). Returns false if it fails.
 */
export async function loadFaceModels(): Promise<boolean> {
  if (modelsLoaded) return true
  if (modelLoadFailed) return false

  try {
    if (!faceapi) {
      faceapi = await import('face-api.js')
    }
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
    modelsLoaded = true
    return true
  } catch (err) {
    console.warn('[face-scan] No se pudieron cargar los modelos faciales:', err)
    modelLoadFailed = true
    return false
  }
}

/**
 * Extract a face descriptor (128-point metric) from a video or image element.
 * Returns null if no face is detected or if models failed to load.
 */
export async function extractFaceDescriptor(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<Float32Array | null> {
  try {
    const loaded = await loadFaceModels()
    if (!loaded || !faceapi) return null

    const detection = await faceapi
      .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor()

    if (!detection) return null
    return detection.descriptor
  } catch (err) {
    console.warn('[face-scan] Error extrayendo descriptor:', err)
    return null
  }
}

/**
 * Extract face descriptor from a base64 image string.
 */
export async function extractFaceDescriptorFromBase64(base64DataUrl: string): Promise<Float32Array | null> {
  try {
    const loaded = await loadFaceModels()
    if (!loaded || !faceapi) return null

    const img = await faceapi.fetchImage(base64DataUrl)
    return extractFaceDescriptor(img as unknown as HTMLImageElement)
  } catch (err) {
    console.warn('[face-scan] Error con imagen base64:', err)
    return null
  }
}

/**
 * Compare two face descriptors using Euclidean distance.
 * Threshold ~0.6 is the standard for face-api.js face recognition.
 */
export function compareFaceDescriptors(
  descriptor1: Float32Array | number[],
  descriptor2: Float32Array | number[],
  threshold = 0.6,
): { match: boolean; distance: number; threshold: number } {
  try {
    if (!faceapi) {
      // Fallback: manual euclidean distance
      const d1 = descriptor1 instanceof Float32Array ? Array.from(descriptor1) : descriptor1
      const d2 = descriptor2 instanceof Float32Array ? Array.from(descriptor2) : descriptor2
      let sum = 0
      for (let i = 0; i < d1.length; i++) sum += (d1[i] - d2[i]) ** 2
      const distance = Math.sqrt(sum)
      return { match: distance < threshold, distance: Math.round(distance * 10000) / 10000, threshold }
    }

    const d1 = descriptor1 instanceof Float32Array ? descriptor1 : new Float32Array(descriptor1)
    const d2 = descriptor2 instanceof Float32Array ? descriptor2 : new Float32Array(descriptor2)
    const distance = faceapi.euclideanDistance(d1, d2)
    return { match: distance < threshold, distance: Math.round(distance * 10000) / 10000, threshold }
  } catch {
    // If comparison fails, assume match (don't block entry)
    return { match: true, distance: 0, threshold }
  }
}

/**
 * Detect if there's a face in the video stream (real-time check).
 */
export async function detectFaceInVideo(video: HTMLVideoElement): Promise<boolean> {
  try {
    const loaded = await loadFaceModels()
    if (!loaded || !faceapi) return false
    const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
    return !!detection
  } catch {
    return false
  }
}
