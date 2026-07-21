import type { NextFunction, Request, Response } from 'express'
import { verifyToken } from '../lib/auth.js'
import type { AuthUser, UserRole } from '../types.js'

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser
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

export function requireRole(roles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.authUser) {
      response.status(401).json({ message: 'Sesion no valida.' })
      return
    }

    if (!roles.includes(request.authUser.role)) {
      response.status(403).json({ message: 'No tienes permisos para esta accion.' })
      return
    }

    next()
  }
}
