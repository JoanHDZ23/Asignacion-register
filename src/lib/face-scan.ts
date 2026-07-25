/**
 * Face scanning utility using face-api.js
 * Extracts 128-dimensional face descriptors for recognition.
 */
import * as faceapi from 'face-api.js'

let modelsLoaded = false

const MODEL_URL = '/models'

/**
 * Load face-api.js models (once).
 */
export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ])
  modelsLoaded = true
}

/**
 * Extract a face descriptor (128-point metric) from a video or image element.
 * Returns null if no face is detected.
 */
export async function extractFaceDescriptor(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<Float32Array | null> {
  await loadFaceModels()

  const detection = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!detection) return null
  return detection.descriptor
}

/**
 * Extract face descriptor from a base64 image string.
 */
export async function extractFaceDescriptorFromBase64(base64DataUrl: string): Promise<Float32Array | null> {
  await loadFaceModels()

  const img = await faceapi.fetchImage(base64DataUrl)
  return extractFaceDescriptor(img as unknown as HTMLImageElement)
}

/**
 * Compare two face descriptors using Euclidean distance.
 * Threshold ~0.6 is the standard for face-api.js face recognition.
 * Lower distance = more similar. Under threshold = same person.
 */
export function compareFaceDescriptors(
  descriptor1: Float32Array | number[],
  descriptor2: Float32Array | number[],
  threshold = 0.6,
): { match: boolean; distance: number; threshold: number } {
  const d1 = descriptor1 instanceof Float32Array ? descriptor1 : new Float32Array(descriptor1)
  const d2 = descriptor2 instanceof Float32Array ? descriptor2 : new Float32Array(descriptor2)
  const distance = faceapi.euclideanDistance(d1, d2)
  return {
    match: distance < threshold,
    distance: Math.round(distance * 10000) / 10000,
    threshold,
  }
}

/**
 * Detect if there's a face in the video stream (real-time check).
 */
export async function detectFaceInVideo(video: HTMLVideoElement): Promise<boolean> {
  await loadFaceModels()
  const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
  return !!detection
}
