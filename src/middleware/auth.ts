import type { NextFunction, Request, Response } from 'express'
import { verifyToken } from '../lib/auth.js'
import { readDatabase } from '../lib/database.js'
import type { AuthUser, UserRole } from '../types.js'

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser
      /** True si el usuario es supervisor (por rol O por cargo). Se resuelve la primera vez que se necesita. */
      _resolvedSupervisor?: boolean
    }
  }
}

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const authorization = request.headers.authorization

  if (!authorization?.startsWith('Bearer ')) {
    response.status(401).json({ message: 'Token requerido.' })
    return
  }

  const token = authorization.replace('Bearer ', '')

  try {
    request.authUser = verifyToken(token)
    next()
  } catch {
    response.status(401).json({ message: 'Token invalido o vencido.' })
  }
}

/**
 * Middleware de roles.
 * Si los roles permitidos incluyen 'supervisor', también verifica si el
 * cargo del usuario en la DB contiene "supervisor" (caso: role=operativo pero cargo=Supervisor de X).
 */
export function requireRole(roles: UserRole[]) {
  return async (request: Request, response: Response, next: NextFunction) => {
    if (!request.authUser) {
      response.status(401).json({ message: 'Sesion no valida.' })
      return
    }

    // Si el role del JWT coincide directamente → OK
    if (roles.includes(request.authUser.role)) {
      next()
      return
    }

    // Si los roles permitidos incluyen 'supervisor', verifica por cargo en DB
    if (roles.includes('supervisor') && request.authUser.role === 'operativo') {
      try {
        if (request._resolvedSupervisor === undefined) {
          const db = await readDatabase()
          const user = db.users.find((u) => u.id === request.authUser!.userId)
          request._resolvedSupervisor = Boolean(user?.cargo?.toLowerCase().includes('supervisor'))
        }
        if (request._resolvedSupervisor) {
          next()
          return
        }
      } catch {
        // Si falla la lectura de DB, usa solo el rol del JWT
      }
    }

    response.status(403).json({ message: 'No tienes permisos para esta accion.' })
  }
}
