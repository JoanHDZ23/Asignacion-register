import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { clearCurrentUser, getCurrentToken, getCurrentUser } from '../lib/auth-storage'

function getTokenExpiry(token: string): number | null {
  try {
    const payloadBase64 = token.split('.')[1]
    if (!payloadBase64) return null
    const decoded = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return decoded.exp ?? null
  } catch {
    return null
  }
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const user = getCurrentUser()
  const token = getCurrentToken()
  // useMemo estabiliza el timestamp para evitar el error de función impura en render
  const now = useMemo(() => Date.now() / 1000, [])

  if (!user || !token) {
    return <Navigate to="/login" replace />
  }

  const exp = getTokenExpiry(token)
  if (exp !== null && now > exp) {
    clearCurrentUser()
    return <Navigate to="/login" replace />
  }

  return children
}
