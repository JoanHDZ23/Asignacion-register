import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CustomForm, type CustomFormField, type CustomFormValues } from '../components'
import { apiRequest, type LoginResponse } from '../lib/api'
import { setCurrentToken, setCurrentUser } from '../lib/auth-storage'

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

export default function LoginPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<LoginStatus>({ kind: 'idle' })

  const description = useMemo(
    () => 'Ingresa solo con el numero de documento registrado previamente en el sistema.',
    [],
  )

  const handleSubmit = async (values: CustomFormValues) => {
    try {
      const loginResponse = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: {
          numeroDocumento: values.numeroDocumento ?? '',
        },
      })

      setStatus({
        kind: 'success',
        message: `Bienvenido, ${loginResponse.user.nombreCompleto}.`,
        user: loginResponse.user,
      })

      setCurrentToken(loginResponse.token)
      setCurrentUser(loginResponse.user)
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'No fue posible iniciar sesion.',
      })
    }
  }

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
            <div>
              <dt>Correo</dt>
              <dd>{status.user.correo}</dd>
            </div>
            <div>
              <dt>Cargo</dt>
              <dd>{status.user.cargo}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </div>
  )
}
