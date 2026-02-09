import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

interface LoginBody {
  username: string;
  password: string;
}

interface JwtPayload {
  username: string;
  iat: number;
  exp: number;
}

interface AdminUserRow {
  email: string;
  password_hash: string;
  is_active?: boolean | null;
}

let _supabase: SupabaseClient | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSupabaseClient(): SupabaseClient {
  if (_supabase) return _supabase;

  // Accept both DEVAI_SUPABASE_* and SUPABASE_* names via config.
  // If these are missing, surface a consistent error to callers.
  const url = config.supabaseUrl;
  const serviceRoleKey = config.supabaseServiceKey;
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase auth is not configured (missing URL and/or service role key).');
  }

  _supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return _supabase;
}

function getJwtSecret(): string {
  return getRequiredEnv('DEVAI_JWT_SECRET');
}

function getJwtExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN || '24h';
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JwtPayload;
  } catch {
    return null;
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  request.user = { username: payload.username } as { username: string };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LoginBody }>('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body;

    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    const normalizedUsername = username.trim().toLowerCase();
    let supabase: SupabaseClient;
    try {
      supabase = getSupabaseClient();
    } catch (err) {
      app.log.error({ err }, 'Auth is misconfigured (Supabase env missing)');
      return reply.status(500).send({ error: 'Authentication unavailable' });
    }

    const { data, error } = await supabase
      .from('admin_users')
      .select('email,password_hash,is_active')
      .eq('email', normalizedUsername)
      .maybeSingle<AdminUserRow>();

    if (error) {
      app.log.error({ err: error }, 'Failed to fetch admin user');
      return reply.status(500).send({ error: 'Authentication unavailable' });
    }

    if (!data || data.is_active === false) {
      app.log.warn({ username: normalizedUsername }, 'Login attempt for unknown or inactive user');
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const passwordValid = await bcrypt.compare(password, data.password_hash);
    if (!passwordValid) {
      app.log.warn({ username: normalizedUsername }, 'Login attempt with wrong password');
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    let token: string;
    try {
      token = jwt.sign(
        { username: normalizedUsername },
        getJwtSecret(),
        { expiresIn: getJwtExpiresIn() as jwt.SignOptions['expiresIn'] }
      );
    } catch (err) {
      app.log.error({ err }, 'Failed to sign JWT');
      return reply.status(500).send({ error: 'Authentication unavailable' });
    }

    return reply.send({
      success: true,
      token,
      expiresIn: getJwtExpiresIn(),
      user: { username: normalizedUsername },
    });
  });

  app.get('/api/auth/verify', async (request, reply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ valid: false, error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      return reply.status(401).send({ valid: false, error: 'Invalid or expired token' });
    }

    return reply.send({
      valid: true,
      user: { username: payload.username },
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
  });
}
