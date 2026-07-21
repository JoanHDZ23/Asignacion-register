import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CustomForm, type CustomFormField, type CustomFormValues } from '../components'
import { apiRequest } from '../lib/api'

const registerFields: CustomFormField[] = [
  {
    name: 'empresa',
    label: 'Empresa',
    placeholder: 'Nombre de la empresa',
    required: true,
    fullWidth: true,
  },
  {
    name: 'nit',
    label: 'NIT',
    placeholder: 'Ingresa el NIT',
    required: true,
  },
  {
    name: 'correoEmpresa',
    label: 'Correo empresa',
    type: 'email',
    placeholder: 'empresa@correo.com',
    required: true,
  },
  {
    name: 'telefonoEmpresa',
    label: 'Telefono empresa',
    type: 'tel',
    placeholder: '3001234567',
  },
  {
    name: 'direccionEmpresa',
    label: 'Direccion',
    placeholder: 'Direccion principal de la compania',
    fullWidth: true,
  },
  {
    name: 'ciudadEmpresa',
    label: 'Ciudad',
    placeholder: 'Ciudad de la compania',
  },
  {
    name: 'adminNombreCompleto',
    label: 'Nombre admin',
    placeholder: 'Nombre completo del administrador',
    required: true,
    fullWidth: true,
  },
  {
    name: 'adminCorreo',
    label: 'Correo admin',
    type: 'email',
    placeholder: 'admin@empresa.com',
    required: true,
  },
  {
    name: 'adminTelefono',
    label: 'Telefono admin',
    type: 'tel',
    placeholder: '3001234567',
    required: true,
  },
  {
    name: 'adminTipoDocumento',
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
    name: 'adminNumeroDocumento',
    label: 'Documento admin',
    placeholder: 'Numero de documento',
    required: true,
    fullWidth: true,
  },
]

type RegisterStatus = {
  kind: 'idle' | 'success' | 'error'
  message?: string
  data?: {
    company: {
      nombre: string
      nit: string
    }
    admin: {
      nombreCompleto: string
      correo: string
      role: string
    }
  }
}

export default function RegisterPage() {
  const [status, setStatus] = useState<RegisterStatus>({ kind: 'idle' })

  const handleSubmit = async (values: CustomFormValues) => {
    try {
      const response = await apiRequest<RegisterStatus['data'] & { message?: string }>(
        '/auth/register-company',
        {
          method: 'POST',
          body: values,
        },
      )

      setStatus({
        kind: 'success',
        message: 'Empresa y administrador registrados correctamente.',
        data: response,
      })
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'No fue posible registrar la empresa.',
      })
    }
  }

  return (
    <div className="auth-page">
      <CustomForm
        title="Registrar empresa"
        description="Crea la empresa y su usuario administrador principal en el backend."
        fields={registerFields}
        submitLabel="Crear empresa"
        onSubmit={handleSubmit}
      />

      <div className={`auth-feedback auth-feedback--${status.kind}`}>
        {status.kind === 'idle' ? (
          <p>Completa el formulario para crear la empresa y su administrador.</p>
        ) : null}

        {status.kind !== 'idle' ? <p>{status.message}</p> : null}

        {status.data ? (
          <dl className="auth-feedback__list">
            <div>
              <dt>Empresa</dt>
              <dd>{status.data.company.nombre}</dd>
            </div>
            <div>
              <dt>Admin</dt>
              <dd>{status.data.admin.nombreCompleto}</dd>
            </div>
          </dl>
        ) : null}

        {status.kind === 'success' ? (
          <Link className="auth-feedback__link" to="/login">
            Ir al login
          </Link>
        ) : null}
      </div>
    </div>
  )
}
