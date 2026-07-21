import type { SVGAttributes } from 'react'
import type { IconName } from './icon-names'

type IconProps = SVGAttributes<SVGSVGElement> & {
  name: IconName
  size?: number
  title?: string
}

export function Icon({
  name,
  size = 20,
  title,
  className = '',
  ...props
}: IconProps) {
  const labelProps = title
    ? { role: 'img', 'aria-label': title }
    : { 'aria-hidden': true }

  return (
    <svg
      {...labelProps}
      {...props}
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
    >
      {title ? <title>{title}</title> : null}
      <use href={`/icons.svg#${name}`} />
    </svg>
  )
}
