import { getDefaultAllowedModules, type AccessModule } from './access'

export type AuthSessionUser = {
  id: string
  companyId: string
  nombreCompleto: string
  correo: string
  cargo: string
  role: 'admin' | 'supervisor' | 'operativo'
  positionId?: string
  allowedModules?: AccessModule[]
}

const CURRENT_USER_KEY = 'ommex_current_user'
const CURRENT_TOKEN_KEY = 'ommex_current_token'

function canUseStorage() {
  return typeof window !== 'undefined'
}

export function setCurrentUser(user: AuthSessionUser) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user))
}

export function setCurrentToken(token: string) {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.setItem(CURRENT_TOKEN_KEY, token)
}

export function getCurrentUser(): AuthSessionUser | null {
  if (!canUseStorage()) {
    return null
  }

  const rawUser = window.localStorage.getItem(CURRENT_USER_KEY)

  if (!rawUser) {
    return null
  }

  try {
    const parsed = JSON.parse(rawUser) as AuthSessionUser

    return {
      ...parsed,
      allowedModules: parsed.allowedModules?.length
        ? parsed.allowedModules
        : getDefaultAllowedModules(parsed.role),
    }
  } catch {
    return null
  }
}

export function getCurrentToken() {
  if (!canUseStorage()) {
    return null
  }

  return window.localStorage.getItem(CURRENT_TOKEN_KEY)
}

export function clearCurrentUser() {
  if (!canUseStorage()) {
    return
  }

  window.localStorage.removeItem(CURRENT_USER_KEY)
  window.localStorage.removeItem(CURRENT_TOKEN_KEY)
}
