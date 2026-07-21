import { useMemo, useState, type ComponentProps } from 'react'
import { Button } from './Button'
import type { CustomFormField, CustomFormValues } from './custom-form.types'

export type CustomFormProps = {
  title?: string
  description?: string
  fields: CustomFormField[]
  submitLabel?: string
  resetLabel?: string
  showReset?: boolean
  onSubmit?: (values: CustomFormValues) => void
}

function createInitialValues(fields: CustomFormField[]) {
  return fields.reduce<CustomFormValues>((accumulator, field) => {
    accumulator[field.name] = field.defaultValue ?? ''
    return accumulator
  }, {})
}

type CustomFormContentProps = CustomFormProps & {
  initialValues: CustomFormValues
}

function CustomFormContent({
  title,
  description,
  fields,
  submitLabel = 'Guardar',
  resetLabel = 'Limpiar',
  showReset = true,
  onSubmit,
  initialValues,
}: CustomFormContentProps) {
  const [values, setValues] = useState<CustomFormValues>(initialValues)

  const handleChange = (name: string, value: string) => {
    setValues((currentValues) => ({
      ...currentValues,
      [name]: value,
    }))
  }

  const handleReset = () => {
    setValues(initialValues)
  }

  const handleSubmit = (
    event: Parameters<NonNullable<ComponentProps<'form'>['onSubmit']>>[0],
  ) => {
    event.preventDefault()
    onSubmit?.(values)
  }

  return (
    <form className="custom-form" onSubmit={handleSubmit}>
      {title || description ? (
        <header className="custom-form__header">
          {title ? <h3>{title}</h3> : null}
          {description ? <p>{description}</p> : null}
        </header>
      ) : null}

      <div className="custom-form__grid">
        {fields.map((field) => {
          const fieldType = field.type ?? 'text'
          const fieldClassName = [
            'custom-form__field',
            field.fullWidth ? 'custom-form__field--full' : '',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <label className={fieldClassName} htmlFor={field.name} key={field.name}>
              <span className="custom-form__label">
                {field.label}
                {field.required ? (
                  <span className="custom-form__required"> *</span>
                ) : null}
              </span>

              {fieldType === 'textarea' ? (
                <textarea
                  className="custom-form__control custom-form__control--textarea"
                  id={field.name}
                  name={field.name}
                  placeholder={field.placeholder}
                  required={field.required}
                  disabled={field.disabled}
                  rows={field.rows ?? 4}
                  value={values[field.name] ?? ''}
                  onChange={(event) => handleChange(field.name, event.target.value)}
                />
              ) : null}

              {fieldType === 'select' ? (
                <select
                  className="custom-form__control"
                  id={field.name}
                  name={field.name}
                  required={field.required}
                  disabled={field.disabled}
                  value={values[field.name] ?? ''}
                  onChange={(event) => handleChange(field.name, event.target.value)}
                >
                  <option value="">{field.placeholder ?? 'Selecciona una opcion'}</option>
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : null}

              {fieldType !== 'textarea' && fieldType !== 'select' ? (
                <input
                  className="custom-form__control"
                  id={field.name}
                  name={field.name}
                  type={fieldType}
                  placeholder={field.placeholder}
                  required={field.required}
                  disabled={field.disabled}
                  value={values[field.name] ?? ''}
                  onChange={(event) => handleChange(field.name, event.target.value)}
                />
              ) : null}

              {field.helperText ? (
                <small className="custom-form__helper">{field.helperText}</small>
              ) : null}
            </label>
          )
        })}
      </div>

      <div className="custom-form__actions">
        {showReset ? (
          <Button type="button" variant="ghost" onClick={handleReset}>
            {resetLabel}
          </Button>
        ) : null}

        <Button icon="documentation-icon" type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export function CustomForm(props: CustomFormProps) {
  const initialValues = useMemo(() => createInitialValues(props.fields), [props.fields])
  const formKey = useMemo(() => JSON.stringify(props.fields), [props.fields])

  return <CustomFormContent key={formKey} {...props} initialValues={initialValues} />
}
