import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { IconName } from './icon-names'
import { Icon } from './Icon'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'
type IconPosition = 'left' | 'right'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  iconPosition?: IconPosition
  fullWidth?: boolean
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  fullWidth = false,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  const iconElement = icon ? (
    <Icon className="button__icon" name={icon} size={18} />
  ) : null

  return (
    <button
      {...props}
      type={type}
      className={[
        'button',
        `button--${variant}`,
        `button--${size}`,
        fullWidth ? 'button--full-width' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {iconPosition === 'left' ? iconElement : null}
      <span>{children}</span>
      {iconPosition === 'right' ? iconElement : null}
    </button>
  )
}
