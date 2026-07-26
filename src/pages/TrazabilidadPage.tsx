import { useState } from 'react'
import { getCurrentUser } from '../lib/auth-storage'

const TRACER_URL = import.meta.env.VITE_TRACER_URL || 'https://ommex-tracer.vercel.app'

/**
 * Página que embedea el microfrontend de Ommex Tracer (trazabilidad fotográfica).
 * Solo accesible si la empresa tiene el módulo 'trazabilidad' habilitado.
 * Pasa companyId como query param para aislamiento multi-empresa.
 */
export default function TrazabilidadPage() {
  const currentUser = getCurrentUser()
  const hasModule = currentUser?.allowedModules?.includes('trazabilidad')
  const [iframeLoaded, setIframeLoaded] = useState(false)

  const iframeUrl = `${TRACER_URL}?companyId=${encodeURIComponent(currentUser?.companyId ?? '')}&user=${encodeURIComponent(currentUser?.nombreCompleto ?? '')}`

  if (!hasModule) {
    return (
      <div className="dashboard-page">
        <section className="content-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <div style={{ fontSize: 48, marginBottom: '1rem' }}>🔒</div>
          <h2 style={{ marginBottom: '.5rem' }}>Módulo no disponible</h2>
          <p style={{ color: 'var(--clr-text-2)', fontSize: 14 }}>
            El módulo de Trazabilidad Fotográfica no está habilitado para tu empresa.
            Contacta al administrador del sistema para activarlo.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {!iframeLoaded && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '.5rem', color: 'var(--clr-text-2)' }}>
          <span className="loading-spinner" />
          Cargando Ommex Tracer...
        </div>
      )}
      <iframe
        src={iframeUrl}
        title="Ommex Tracer"
        onLoad={() => setIframeLoaded(true)}
        style={{
          width: '100%',
          flex: 1,
          border: 'none',
          display: iframeLoaded ? 'block' : 'none',
          minHeight: 'calc(100dvh - 60px)',
        }}
        allow="camera; geolocation"
      />
    </div>
  )
}
