import { useCallback, useEffect, useState } from 'react'
import { Button, CustomForm, Icon, Modal, type CustomFormField, type CustomFormValues } from '../components'
import { apiRequest } from '../lib/api'

// ── Types ───────────────────────────────────────────────────────────────────
type RootCompany = {
  id: string
  nombre: string
  nit: string
  correo: string
  telefono?: string
  direccion?: string
  ciudad?: string
  tipo: 'empresa' | 'academia'
  activa: boolean
  enabledModules?: string[]
  adminCount: number
  employeeCount: number
  createdAt: string
}

type RootLoginResponse = {
  token: string
  user: { role: 'root'; username: string }
}

// ── Storage helpers (separate from normal auth) ─────────────────────────────
const ROOT_TOKEN_KEY = 'ommex_root_token'

function getRootToken() {
  return localStorage.getItem(ROOT_TOKEN_KEY)
}
function setRootToken(token: string) {
  localStorage.setItem(ROOT_TOKEN_KEY, token)
}
function clearRootToken() {
  localStorage.removeItem(ROOT_TOKEN_KEY)
}

// ── New company form fields ─────────────────────────────────────────────────
const newCompanyFields: CustomFormField[] = [
  {
    name: 'tipo',
    label: 'Tipo de gestión',
    type: 'select',
    required: true,
    fullWidth: true,
    defaultValue: 'empresa',
    options: [
      { label: 'Empresa', value: 'empresa' },
      { label: 'Academia', value: 'academia' },
    ],
  },
  { name: 'nombre', label: 'Nombre', placeholder: 'Nombre de la empresa', required: true, fullWidth: true },
  { name: 'nit', label: 'NIT', placeholder: 'NIT de la empresa', required: true },
  { name: 'correo', label: 'Correo', type: 'email', placeholder: 'correo@empresa.com', required: true },
  { name: 'telefono', label: 'Teléfono', type: 'tel', placeholder: '3001234567' },
  { name: 'direccion', label: 'Dirección', placeholder: 'Dirección principal' },
  { name: 'ciudad', label: 'Ciudad', placeholder: 'Ciudad' },
]

// ── Component ───────────────────────────────────────────────────────────────
export default function RootPanelPage() {
  const [token, setToken] = useState<string | null>(getRootToken)
  const [companies, setCompanies] = useState<RootCompany[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  // Login state
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)

  const fetchCompanies = useCallback(async (authToken: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiRequest<RootCompany[]>('/root/companies', { token: authToken })
      setCompanies(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error cargando empresas'
      setError(message)
      // If unauthorized, clear token
      if (message.includes('401') || message.includes('Token')) {
        clearRootToken()
        setToken(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) {
      fetchCompanies(token)
    }
  }, [token, fetchCompanies])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(null)
    setLoginLoading(true)

    try {
      const res = await apiRequest<RootLoginResponse>('/root/login', {
        method: 'POST',
        body: { username: loginUsername, password: loginPassword },
      })
      setRootToken(res.token)
      setToken(res.token)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Error de autenticación')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = () => {
    clearRootToken()
    setToken(null)
    setCompanies([])
  }

  const handleToggleCompany = async (companyId: string, currentActiva: boolean) => {
    if (!token) return
    try {
      await apiRequest(`/root/companies/${companyId}`, {
        method: 'PATCH',
        token,
        body: { activa: !currentActiva },
      })
      setCompanies((prev) =>
        prev.map((c) => (c.id === companyId ? { ...c, activa: !currentActiva } : c)),
      )
      setFeedback({ kind: 'success', message: `Empresa ${!currentActiva ? 'activada' : 'desactivada'}.` })
    } catch (err) {
      setFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error' })
    }
  }

  const handleToggleTrazabilidad = async (company: RootCompany) => {
    if (!token) return
    const modules = company.enabledModules ?? []
    const hasTraz = modules.includes('trazabilidad')
    const newModules = hasTraz
      ? modules.filter((m) => m !== 'trazabilidad')
      : [...modules, 'trazabilidad']

    try {
      await apiRequest(`/root/companies/${company.id}/modules`, {
        method: 'PATCH',
        token,
        body: { enabledModules: newModules },
      })
      setCompanies((prev) =>
        prev.map((c) => (c.id === company.id ? { ...c, enabledModules: newModules } : c)),
      )
      setFeedback({ kind: 'success', message: `Trazabilidad ${hasTraz ? 'deshabilitada' : 'habilitada'} para ${company.nombre}.` })
    } catch (err) {
      setFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error' })
    }
  }

  const handleCreateCompany = async (values: CustomFormValues) => {
    if (!token) return
    try {
      await apiRequest('/root/companies', {
        method: 'POST',
        token,
        body: values,
      })
      setShowCreateModal(false)
      setFeedback({ kind: 'success', message: 'Empresa creada correctamente.' })
      fetchCompanies(token)
    } catch (err) {
      setFeedback({ kind: 'error', message: err instanceof Error ? err.message : 'Error creando empresa' })
    }
  }

  // ── Login screen ────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="root-panel-login">
        <div className="root-panel-login__card">
          <div className="root-panel-login__header">
            <div className="root-panel-login__icon">
              <Icon name="icon-shield" size={28} />
            </div>
            <h1>Panel Root</h1>
            <p>Acceso de superadministrador del sistema</p>
          </div>

          <form className="root-panel-login__form" onSubmit={handleLogin}>
            <div className="root-panel-login__field">
              <label htmlFor="root-user">Usuario</label>
              <input
                id="root-user"
                type="text"
                placeholder="Username"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="root-panel-login__field">
              <label htmlFor="root-pass">Contraseña</label>
              <input
                id="root-pass"
                type="password"
                placeholder="Password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>

            {loginError && <p className="root-panel-login__error">{loginError}</p>}

            <Button type="submit" variant="primary" fullWidth disabled={loginLoading}>
              {loginLoading ? 'Verificando...' : 'Ingresar como Root'}
            </Button>
          </form>
        </div>
      </div>
    )
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────
  return (
    <div className="root-panel">
      {/* Header */}
      <header className="root-panel__header">
        <div className="root-panel__header-left">
          <div className="root-panel__badge">
            <Icon name="icon-shield" size={20} />
          </div>
          <div>
            <h1>Panel Root — Gestión de Empresas</h1>
            <p>{companies.length} empresas registradas</p>
          </div>
        </div>
        <div className="root-panel__header-right">
          <Button variant="primary" icon="icon-plus" onClick={() => setShowCreateModal(true)}>
            Nueva empresa
          </Button>
          <Button variant="ghost" onClick={handleLogout}>
            Cerrar sesión
          </Button>
        </div>
      </header>

      {/* Feedback */}
      {feedback && (
        <div className={`feedback-banner feedback-banner--${feedback.kind}`}>
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)}>✕</button>
        </div>
      )}

      {/* Loading / Error */}
      {loading && <div className="root-panel__loading">Cargando empresas...</div>}
      {error && <div className="root-panel__error">{error}</div>}

      {/* Companies grid */}
      {!loading && !error && (
        <div className="root-panel__grid">
          {companies.map((company) => (
            <div
              key={company.id}
              className={`root-company-card ${!company.activa ? 'root-company-card--inactive' : ''}`}
            >
              <div className="root-company-card__header">
                <div className="root-company-card__avatar">
                  {company.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="root-company-card__title">
                  <strong>{company.nombre}</strong>
                  <span className={`root-company-card__type root-company-card__type--${company.tipo}`}>
                    {company.tipo}
                  </span>
                </div>
                <span className={`status-badge status-badge--${company.activa ? 'confirmado' : 'rechazado'}`}>
                  {company.activa ? 'Activa' : 'Inactiva'}
                </span>
              </div>

              <div className="root-company-card__details">
                <div className="root-company-card__detail">
                  <Icon name="icon-clipboard" size={14} />
                  <span>NIT: {company.nit}</span>
                </div>
                <div className="root-company-card__detail">
                  <Icon name="icon-user" size={14} />
                  <span>{company.correo}</span>
                </div>
                {company.ciudad && (
                  <div className="root-company-card__detail">
                    <Icon name="icon-map-pin" size={14} />
                    <span>{company.ciudad}</span>
                  </div>
                )}
              </div>

              <div className="root-company-card__stats">
                <div className="root-company-card__stat">
                  <strong>{company.adminCount}</strong>
                  <span>Admins</span>
                </div>
                <div className="root-company-card__stat">
                  <strong>{company.employeeCount}</strong>
                  <span>Empleados</span>
                </div>
                <div className="root-company-card__stat">
                  <strong>{new Date(company.createdAt).toLocaleDateString('es-CO')}</strong>
                  <span>Creada</span>
                </div>
              </div>

              <div className="root-company-card__actions">
                <Button
                  variant={company.activa ? 'ghost' : 'primary'}
                  size="sm"
                  onClick={() => handleToggleCompany(company.id, company.activa)}
                >
                  {company.activa ? 'Desactivar' : 'Activar'}
                </Button>
                <Button
                  variant={(company.enabledModules ?? []).includes('trazabilidad') ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => handleToggleTrazabilidad(company)}
                >
                  {(company.enabledModules ?? []).includes('trazabilidad') ? '📷 Trazabilidad ✓' : '📷 Habilitar Trazabilidad'}
                </Button>
              </div>
            </div>
          ))}

          {companies.length === 0 && (
            <div className="root-panel__empty">
              <p>No hay empresas registradas aún.</p>
            </div>
          )}
        </div>
      )}

      {/* Create company modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Crear nueva empresa"
      >
        <CustomForm
          title=""
          description="Crea una empresa sin usuario administrador asociado."
          fields={newCompanyFields}
          submitLabel="Crear empresa"
          onSubmit={handleCreateCompany}
        />
      </Modal>
    </div>
  )
}
