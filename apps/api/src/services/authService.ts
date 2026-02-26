/**
 * Auth service — reusable authentication logic extracted from the route handler.
 *
 * Handles:
 *  - Admin user lookup via service role client
 *  - Password verification
 *  - JWT token generation and verification
 */

import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from '../config.js'

interface AdminUserRow {
  email: string
  password_hash: string
  is_active?: boolean | null
}

export interface JwtPayload {
  username: string
  iat: number
  exp: number
}

export interface AuthUser {
  username: string
}

let _authClient: SupabaseClient | null = null

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function getAuthClient(): SupabaseClient {
  if (_authClient) return _authClient

  const url = config.supabaseUrl
  const serviceRoleKey = config.supabaseServiceKey
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase auth is not configured (missing URL and/or service role key).')
  }

  _authClient = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  return _authClient
}

function getJwtSecret(): string {
  return getRequiredEnv('DEVAI_JWT_SECRET')
}

function getJwtExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN || '24h'
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JwtPayload
  } catch (err) {
    console.warn('[authService] Token verification failed:', err instanceof Error ? err.message : err)
    return null
  }
}

function getTokenTtlSeconds(expiresIn: string): number {
  const normalized = expiresIn.trim().toLowerCase()
  const match = normalized.match(/^(\d+)\s*(ms|s|m|h|d)?$/)
  if (!match) return 24 * 60 * 60

  const value = Number.parseInt(match[1], 10)
  const unit = match[2] || 's'
  if (!Number.isFinite(value) || value <= 0) return 24 * 60 * 60

  if (unit === 'ms') return Math.max(1, Math.floor(value / 1000))
  if (unit === 's') return value
  if (unit === 'm') return value * 60
  if (unit === 'h') return value * 60 * 60
  if (unit === 'd') return value * 24 * 60 * 60
  return 24 * 60 * 60
}

export interface IssuedAuthToken {
  token: string
  expiresIn: string
  expiresInSeconds: number
  expiresAt: string
}

export function issueAuthToken(username: string): IssuedAuthToken {
  const expiresIn = getJwtExpiresIn()
  const token = jwt.sign(
    { username },
    getJwtSecret(),
    { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] },
  )
  const payload = verifyToken(token)
  if (!payload) {
    throw new Error('Failed to verify freshly issued token')
  }
  return {
    token,
    expiresIn,
    expiresInSeconds: getTokenTtlSeconds(expiresIn),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  }
}

export interface LoginResult {
  success: true
  token: string
  expiresIn: string
  expiresInSeconds: number
  expiresAt: string
  user: AuthUser
}

export interface LoginError {
  success: false
  error: string
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<LoginResult | LoginError> {
  if (!username || !password) {
    return { success: false, error: 'Username and password required' }
  }

  const normalizedUsername = username.trim().toLowerCase()

  let client: SupabaseClient
  try {
    client = getAuthClient()
  } catch (err) {
    console.warn('[authService] Auth client unavailable:', err instanceof Error ? err.message : err)
    return { success: false, error: 'Authentication unavailable' }
  }

  const { data, error } = await client
    .from('admin_users')
    .select('email,password_hash,is_active')
    .eq('email', normalizedUsername)
    .maybeSingle<AdminUserRow>()

  if (error) {
    console.error('[authService] Failed to fetch admin user:', error)
    return { success: false, error: 'Authentication unavailable' }
  }

  if (!data || data.is_active === false) {
    return { success: false, error: 'Invalid credentials' }
  }

  const passwordValid = await bcrypt.compare(password, data.password_hash)
  if (!passwordValid) {
    return { success: false, error: 'Invalid credentials' }
  }

  let issued: IssuedAuthToken
  try {
    issued = issueAuthToken(normalizedUsername)
  } catch (err) {
    console.error('[authService] Failed to sign JWT:', err)
    return { success: false, error: 'Authentication unavailable' }
  }

  return {
    success: true,
    token: issued.token,
    expiresIn: issued.expiresIn,
    expiresInSeconds: issued.expiresInSeconds,
    expiresAt: issued.expiresAt,
    user: { username: normalizedUsername },
  }
}

export function getCookieOptions(maxAgeSeconds: number = getTokenTtlSeconds(getJwtExpiresIn())) {
  return {
    httpOnly: true,
    secure: config.nodeEnv !== 'development',
    sameSite: 'strict' as const,
    path: '/api',
    maxAge: maxAgeSeconds,
  }
}
