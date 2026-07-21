import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CustomForm, type CustomFormField, type CustomFormValues } from '../components'
import {
  apiRequest,
  type UserInvitationDetailResponse,
} from '../lib/api'

type InvitationStatusState = {
  kind: 'loading' | 'ready' | 'success' | 'error'
  message?: string
}

export default function MemberInvitationPage() {
  const { token } = useParams()
  const [invitation, setInvitation] = useState<UserInvitationDetailResponse | null>(null)
  const [status, setStatus] = useState<InvitationStatusState>({ kind: 'loading' })

  useEffect(() => {
    if (!token) return   // si no hay token, el estado inicial 'loading' se mantiene — manejo por render

    void apiRequest<UserInvitationDetailResponse>(`/auth/member-invitations/${token}`)
      .then((response) => {
        setInvitation(response)
        setStatus({ kind: 'ready' })
      })
      .catch((error: unknown) => {
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'No fue posible validar el enlace.',
        })
      })
  }, [token])

  const fields = useMemo<CustomFormField[]>(() => {
    if (!invitation) {
      return []
    }

    return [
      {
        name: 'cargo',
        label: 'Cargo asignado',
        defaultValue: invitation.cargo,
        disabled: true,
      },
      {
        name: 'role',
        label: 'Rol asignado',
        defaultValue: invitation.role,
        disabled: true,
      },
      {
        name: 'nombreCompleto',
        label: 'Nombre completo',
        placeholder: 'Ingresa tu nombre completo',
        required: true,
        fullWidth: true,
      },
      {
        name: 'tipoDocumento',
        label: 'Tipo de documento',
        type: 'select',
        placeholder: 'Selecciona tipo de documento',
        required: true,
        options: [
          { label: 'Cedula de ciudadania', value: 'cc' },
          { label: 'Cedula de extranjeria', value: 'ce' },
          { label: 'Pasaporte', value: 'pasaporte' },
          { label: 'Tarjeta de identidad', value: 'ti' },
        ],
      },
      {
        name: 'numeroDocumento',
        label: 'Numero de documento',
        placeholder: 'Ingresa tu numero de documento',
        required: true,
      },
      {
        name: 'correo',
        label: 'Correo',
        type: 'email',
        placeholder: 'correo@empresa.com',
        required: true,
      },
      {
        name: 'telefono',
        label: 'Telefono',
        type: 'tel',
        placeholder: '3001234567',
        required: true,
      },
    ]
  }, [invitation])

  const handleSubmit = async (values: CustomFormValues) => {
    if (!token) {
      return
    }

    try {
      await apiRequest<{ message: string }>(`/auth/member-invitations/${token}/complete`, {
        method: 'POST',
        body: {
          nombreCompleto: values.nombreCompleto ?? '',
          tipoDocumento: values.tipoDocumento ?? '',
          numeroDocumento: values.numeroDocumento ?? '',
          correo: values.correo ?? '',
          telefono: values.telefono ?? '',
        },
      })

      setStatus({
        kind: 'success',
        message:
          'Registro completado correctamente. Ya puedes ingresar con tu numero de documento.',
      })
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'No fue posible completar el registro.',
      })
    }
  }

  return (
    <div className="auth-page">
      {/* Sin token en la URL — enlace inválido */}
      {!token ? (
        <div className="auth-feedback auth-feedback--error">
          <p>El enlace de registro no es valido.</p>
        </div>
      ) : status.kind === 'loading' ? (
        <div className="auth-feedback">
          <p>Validando enlace de registro...</p>
        </div>
      ) : null}

      {status.kind === 'ready' && invitation ? (
        <>
          <CustomForm
            title="Completar registro de integrante"
            description={`Estas vinculado a ${invitation.company?.nombre ?? 'tu empresa'} con el cargo ${invitation.cargo}.`}
            fields={fields}
            submitLabel="Completar registro"
            showReset={false}
            onSubmit={handleSubmit}
          />

          <div className="auth-feedback">
            <p>El cargo y el rol ya fueron definidos por el administrador. Solo completa tus datos personales.</p>
          </div>
        </>
      ) : null}

      {status.kind === 'success' ? (
        <div className="auth-feedback auth-feedback--success">
          <p>{status.message}</p>
          <Link className="auth-feedback__link" to="/login">
            Ir al login
          </Link>
        </div>
      ) : null}

      {status.kind === 'error' ? (
        <div className="auth-feedback auth-feedback--error">
          <p>{status.message}</p>
        </div>
      ) : null}
    </div>
  )
}
