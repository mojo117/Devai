import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  verifyToken,
  authenticateUser,
  issueAuthToken,
  getCookieOptions,
  type AuthUser,
  type JwtPayload,
} from '../services/authService.js'

export type { JwtPayload, AuthUser }

function getRequestToken(request: FastifyRequest): string | undefined {
  const cookieToken = request.cookies?.devai_token
  const headerToken = request.headers.authorization?.startsWith('Bearer ')
    ? request.headers.authorization.substring(7)
    : undefined
  return cookieToken || headerToken
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = getRequestToken(request)

  if (!token) {
    return reply.status(401).send({ error: 'No token provided' })
  }

  const payload = verifyToken(token)

  if (!payload) {
    return reply.status(401).send({ error: 'Invalid or expired token' })
  }

  request.user = { username: payload.username } as AuthUser
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { username: string; password: string } }>('/api/auth/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '15 minutes',
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body

    const result = await authenticateUser(username, password)

    if (!result.success) {
      const status = result.error === 'Authentication unavailable' ? 500 : 401
      if (status === 401) {
        app.log.warn({ username }, 'Failed login attempt')
      }
      return reply.status(status).send({ error: result.error })
    }

    reply.setCookie('devai_token', result.token, getCookieOptions(result.expiresInSeconds))

    return reply.send(result)
  })

  app.get('/api/auth/verify', async (request, reply) => {
    const token = getRequestToken(request)

    if (!token) {
      return reply.status(401).send({ valid: false, error: 'No token provided' })
    }

    const payload = verifyToken(token)

    if (!payload) {
      return reply.status(401).send({ valid: false, error: 'Invalid or expired token' })
    }

    return reply.send({
      valid: true,
      token,
      user: { username: payload.username },
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    })
  })

  app.post('/api/auth/refresh', async (request, reply) => {
    const token = getRequestToken(request)

    if (!token) {
      return reply.status(401).send({ valid: false, error: 'No token provided' })
    }

    const payload = verifyToken(token)
    if (!payload) {
      return reply.status(401).send({ valid: false, error: 'Invalid or expired token' })
    }

    const issued = issueAuthToken(payload.username)
    reply.setCookie('devai_token', issued.token, getCookieOptions(issued.expiresInSeconds))

    return reply.send({
      valid: true,
      token: issued.token,
      expiresIn: issued.expiresIn,
      expiresAt: issued.expiresAt,
      user: { username: payload.username },
    })
  })

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie('devai_token', { path: '/api' })
    return reply.send({ success: true })
  })
}
