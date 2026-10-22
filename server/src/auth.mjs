import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const N = 16384;
const R = 8;
const P = 1;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

/** Hash de relleno: login de un usuario inexistente tarda lo mismo que uno real. */
export const DUMMY_HASH = await hashPassword('dsb-relleno-no-usar');

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (password.length > 200) return 'La contraseña es demasiado larga.';
  return null;
}

export function validateUsername(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]{3,40}$/.test(name)) return 'El usuario debe tener 3 a 40 caracteres: letras, números, punto, guion o guion bajo.';
  return null;
}

export const sha256 = text => createHash('sha256').update(text).digest('hex');

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export const COOKIE = 'dsb_session';

export function parseCookies(header) {
  const out = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure, maxAgeSeconds }) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

/** Freno simple a la fuerza bruta (en memoria): `max` fallos bloquean `lockSeconds`. */
export class LoginLimiter {
  constructor(max, lockSeconds) {
    this.max = max;
    this.lockMs = lockSeconds * 1000;
    this.map = new Map();
  }

  blockedFor(key, now = Date.now()) {
    const e = this.map.get(key);
    return e && e.until > now ? Math.ceil((e.until - now) / 1000) : 0;
  }

  fail(key, now = Date.now()) {
    const e = this.map.get(key) ?? { fails: 0, until: 0 };
    if (e.until && e.until <= now) e.fails = 0;
    e.fails++;
    if (e.fails >= this.max) {
      e.until = now + this.lockMs;
      e.fails = 0;
    }
    this.map.set(key, e);
  }

  ok(key) {
    this.map.delete(key);
  }
}
