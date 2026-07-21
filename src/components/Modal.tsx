import type { ReactNode } from 'react'
import { Button } from './Button'

export type ModalProps = {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ open, title, description, onClose, children }: ModalProps) {
  if (!open) {
    return null
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button
        aria-label="Cerrar modal"
        className="modal__backdrop"
        type="button"
        onClick={onClose}
      />
      <div className="modal__surface">
        <header className="modal__header">
          <div>
            <h3 id="modal-title">{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </header>
        <div className="modal__content">{children}</div>
      </div>
    </div>
  )
}
