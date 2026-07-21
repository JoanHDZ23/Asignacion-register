export type CustomFormFieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'date'
  | 'time'
  | 'password'
  | 'select'
  | 'textarea'

export type CustomFormOption = {
  label: string
  value: string
}

export type CustomFormValues = Record<string, string>

export type CustomFormField = {
  name: string
  label: string
  type?: CustomFormFieldType
  placeholder?: string
  helperText?: string
  defaultValue?: string
  required?: boolean
  disabled?: boolean
  rows?: number
  fullWidth?: boolean
  options?: CustomFormOption[]
}
