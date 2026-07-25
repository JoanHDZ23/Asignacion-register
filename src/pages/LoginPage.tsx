import { useMemo, useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { startRegistration } from '@simplewebauthn/browser'
import { Button, CustomForm, Icon, type CustomFormField, type CustomFormValues } from '../components'
import { apiRequest, type LoginResponse, type VerifyBiometricRegistrationResponse } from '../lib/api'
import { getCurrentToken, setCurrentToken, setCurrentUser } from '../lib/auth-storage'

const loginFields: CustomFormField[] = [
  {
    name: 'numeroDocumento',
    label: 'Numero de documento',
    placeholder: 'Ingresa tu numero de documento',
    required: true,
  },
]

type LoginStatus = {
  kind: 'idle' | 'success' | 'error'
  message?: string
  user?: LoginResponse['user']
}

type SetupStep = 'none' | 'biometric' | 'face' | 'done'

export default function LoginPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<LoginStatus>({ kind: 'idle' })
  const [setupStep, setSetupStep] = useState<SetupStep>('none')
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupMsg, setSetupMsg] = useState('')

  // Face registration refs
  const faceVideoRef = useRef<HTMLVideoElement>(null)
  const faceStreamRef = useRef<MediaStream | null>(null)
  const faceCanvasRef = useRef<HTMLCanvasElement>(null)
  const [faceDetected, setFaceDetected] = useState(false)
  const [facePhoto, setFacePhoto] = useState<string | null>(null)

  const description = useMemo(
    () => 'Ingresa con tu numero de documento o usa biometria si ya la activaste.',
    [],
  )

  const handleSubmit = async (values: CustomFormValues) => {
    try {
      const loginResponse = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { numeroDocumento: values.numeroDocumento ?? '' },
      })

      setStatus({
        kind: 'success',
        message: `Bienvenido, ${loginResponse.user.nombreCompleto}.`,
        user: loginResponse.user,
      })

      setCurrentToken(loginResponse.token)
      setCurrentUser(loginResponse.user)

      // Check if user needs biometric/face setup (first login only)
      try {
        const [bioStatus, faceStatus] = await Promise.all([
          apiRequest<{ biometricConfigured: boolean }>('/attendance/biometric-status', { token: loginResponse.token }),
          apiRequest<{ hasFaceRegistered: boolean; canRegisterFace: boolean }>('/attendance/face-status', { token: loginResponse.token }),
        ])

        // Si ya tiene biometría Y rostro (sin reset pendiente) → directo al dashboard
        if (bioStatus.biometricConfigured && faceStatus.hasFaceRegistered && !faceStatus.canRegisterFace) {
          navigate('/dashboard', { replace: true })
          return
        }

        // Si no tiene biometría → pide activarla
        if (!bioStatus.biometricConfigured) {
          setSetupStep('biometric')
          return
        }

        // Si puede registrar rostro (no tiene o admin lo reseteó) → pide rostro
        if (faceStatus.canRegisterFace) {
          setSetupStep('face')
          return
        }
      } catch {
        // Si falla la verificación, ir al dashboard normalmente
      }

      navigate('/dashboard', { replace: true })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'No fue posible iniciar sesion.',
      })
    }
  }

  // ── Biometric setup ──
  const handleSetupBiometric = async () => {
    const token = getCurrentToken()
    if (!token) return
    setSetupBusy(true)
    setSetupMsg('')
    try {
      const options = await apiRequest<Parameters<typeof startRegistration>[0]['optionsJSON']>(
        '/attendance/generate-registration-options', { method: 'POST', token })
      const responseJSON = await startRegistration({ optionsJSON: options })
      await apiRequest<VerifyBiometricRegistrationResponse>(
        '/attendance/verify-registration', { method: 'POST', token, body: { responseJSON } })
      setSetupMsg('✓ Biometría activada correctamente')

      // Check face status
      const faceStatus = await apiRequest<{ hasFaceRegistered: boolean; canRegisterFace: boolean }>('/attendance/face-status', { token }).catch(() => null)
      if (faceStatus && !faceStatus.hasFaceRegistered && faceStatus.canRegisterFace) {
        setTimeout(() => setSetupStep('face'), 1000)
      } else {
        setTimeout(() => navigate('/dashboard', { replace: true }), 1000)
      }
    } catch (err) {
      const cancelled = err instanceof Error && (err.name === 'NotAllowedError' || err.message.includes('not allowed'))
      setSetupMsg(cancelled ? 'Cancelado por el usuario' : (err instanceof Error ? err.message : 'Error'))
    } finally {
      setSetupBusy(false)
    }
  }

  const skipBiometric = async () => {
    // Check if face is already registered before showing face step
    const token = getCurrentToken()
    if (token) {
      try {
        const faceStatus = await apiRequest<{ hasFaceRegistered: boolean; canRegisterFace: boolean }>('/attendance/face-status', { token })
        if (faceStatus.hasFaceRegistered || !faceStatus.canRegisterFace) {
          navigate('/dashboard', { replace: true })
          return
        }
      } catch { /* proceed to face step */ }
    }
    setSetupStep('face')
  }

  // ── Face registration ──
  useEffect(() => {
    if (setupStep !== 'face') return
    let cancelled = false
    let animFrame = 0

    const startCam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        faceStreamRef.current = stream
        if (faceVideoRef.current) faceVideoRef.current.srcObject = stream

        // Detection loop
        const faceapi = await import('face-api.js')
        const { loadFaceModels } = await import('../lib/face-scan')
        await loadFaceModels()

        const detect = async () => {
          if (cancelled || !faceVideoRef.current) return
          const canvas = faceCanvasRef.current
          const video = faceVideoRef.current
          if (!canvas || video.readyState < 2) { animFrame = requestAnimationFrame(() => void detect()); return }
          canvas.width = video.videoWidth; canvas.height = video.videoHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          const det = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 })).withFaceLandmarks()
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          if (det) {
            setFaceDetected(true)
            const box = det.detection.box
            ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3
            ctx.strokeRect(box.x, box.y, box.width, box.height)
            ctx.fillStyle = '#22c55e'
            for (const p of det.landmarks.positions) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill() }
          } else { setFaceDetected(false) }
          if (!cancelled) animFrame = requestAnimationFrame(() => void detect())
        }
        void detect()
      } catch { /* no camera */ }
    }
    void startCam()
    return () => { cancelled = true; cancelAnimationFrame(animFrame); faceStreamRef.current?.getTracks().forEach((t) => t.stop()); faceStreamRef.current = null }
  }, [setupStep])

  const captureFace = () => {
    const video = faceVideoRef.current
    if (!video) return
    const c = document.createElement('canvas')
    c.width = video.videoWidth || 640; c.height = video.videoHeight || 480
    c.getContext('2d')?.drawImage(video, 0, 0)
    setFacePhoto(c.toDataURL('image/jpeg', 0.85))
  }

  const submitFace = async () => {
    const token = getCurrentToken()
    if (!token || !facePhoto) return
    setSetupBusy(true)
    setSetupMsg('')
    try {
      const { extractFaceDescriptorFromBase64 } = await import('../lib/face-scan')
      const descriptor = await extractFaceDescriptorFromBase64(facePhoto)
      if (!descriptor) { setSetupMsg('No se detectó rostro. Intenta de nuevo.'); setFacePhoto(null); setSetupBusy(false); return }
      const base64 = facePhoto.split(',')[1] ?? ''
      await apiRequest('/attendance/register-face', { method: 'POST', token, body: { imageBase64: base64, faceDescriptor: Array.from(descriptor) } })
      setSetupMsg('✓ Rostro registrado correctamente')
      faceStreamRef.current?.getTracks().forEach((t) => t.stop())
      setTimeout(() => navigate('/dashboard', { replace: true }), 1200)
    } catch (err) {
      setSetupMsg(err instanceof Error ? err.message : 'Error')
    } finally { setSetupBusy(false) }
  }

  const skipFace = () => { faceStreamRef.current?.getTracks().forEach((t) => t.stop()); navigate('/dashboard', { replace: true }) }

  // ── Setup: Biometric step ──
  if (setupStep === 'biometric') {
    return (
      <div className="auth-page">
        <div className="setup-card">
          <div className="setup-card__icon"><Icon name="icon-fingerprint" size={32} /></div>
          <h2>Activa tu biometría</h2>
          <p>Configura huella o Face ID para acceder más rápido la próxima vez.</p>
          {setupMsg && <p className={setupMsg.startsWith('✓') ? 'turn-table__success' : 'turn-table__error'}>{setupMsg}</p>}
          <Button type="button" variant="primary" fullWidth disabled={setupBusy} onClick={() => void handleSetupBiometric()}>
            {setupBusy ? 'Configurando...' : 'Activar biometría'}
          </Button>
          <Button type="button" variant="ghost" fullWidth onClick={skipBiometric}>
            Omitir por ahora
          </Button>
        </div>
      </div>
    )
  }

  // ── Setup: Face registration step ──
  if (setupStep === 'face') {
    return (
      <div className="auth-page">
        <div className="setup-card">
          <h2>Registro facial</h2>
          <p>Escanea tu rostro para verificar tu identidad al marcar entrada.</p>
          {setupMsg && <p className={setupMsg.startsWith('✓') ? 'turn-table__success' : 'turn-table__error'}>{setupMsg}</p>}
          {!facePhoto ? (
            <>
              <div className="face-scan-container">
                <video ref={faceVideoRef} autoPlay playsInline muted className="face-scan-video" />
                <canvas ref={faceCanvasRef} className="face-scan-overlay" />
                <div className="face-scan-frame" />
                <div className="face-scan-hud">
                  <div className={`face-scan-status ${faceDetected ? 'face-scan-status--ok' : ''}`}>
                    <span className="face-scan-dot" />{faceDetected ? 'Rostro detectado' : 'Buscando rostro...'}
                  </div>
                </div>
              </div>
              <Button type="button" variant="primary" fullWidth disabled={!faceDetected} onClick={captureFace}>
                {faceDetected ? 'Capturar rostro' : 'Esperando detección...'}
              </Button>
            </>
          ) : (
            <>
              <img src={facePhoto} alt="Rostro" style={{ width: '100%', borderRadius: '12px', aspectRatio: '4/3', objectFit: 'cover' }} />
              <Button type="button" variant="primary" fullWidth disabled={setupBusy} onClick={() => void submitFace()}>
                {setupBusy ? 'Procesando...' : 'Registrar rostro'}
              </Button>
              <Button type="button" variant="ghost" fullWidth onClick={() => setFacePhoto(null)}>Repetir</Button>
            </>
          )}
          <Button type="button" variant="ghost" fullWidth onClick={skipFace}>Omitir</Button>
        </div>
      </div>
    )
  }

  // ── Normal login form ──
  return (
    <div className="auth-page">
      <CustomForm
        title="Iniciar sesion"
        description={description}
        fields={loginFields}
        submitLabel="Ingresar"
        showReset={false}
        onSubmit={handleSubmit}
      />

      <div className={`auth-feedback auth-feedback--${status.kind}`}>
        {status.kind === 'idle' ? (
          <p>Ingresa con el numero de documento registrado.</p>
        ) : null}
        {status.kind !== 'idle' ? <p>{status.message}</p> : null}
        {status.user ? (
          <dl className="auth-feedback__list">
            <div><dt>Correo</dt><dd>{status.user.correo}</dd></div>
            <div><dt>Cargo</dt><dd>{status.user.cargo}</dd></div>
          </dl>
        ) : null}
      </div>
    </div>
  )
}
