// Accounts and sessions for the hosted dashboard.
//
// Multiple people share the one deployment now, so the single shared password
// became real accounts: email + scrypt password hash in the users table, a
// stateless signed cookie for browser sessions, and a per-user bearer token
// for `scripts/push.mjs`. Still zero dependencies — everything here is
// node:crypto.
//
// The cookie is `v1.<userId>.<expiresEpoch>.<hmac>`, signed with a session
// secret. The secret is SESSION_SECRET when set, otherwise derived by HMAC
// from the Supabase service role key — which is already required, server-only,
// and high-entropy — so a deployment needs no extra secret to configure.
// No server-side session store: rotating the secret (or the service key)
// logs everyone out; deleting a user invalidates them at the guard's lookup.
//
// Fail closed: if no secret material exists, every guarded route errors
// rather than opening up. (The previous design silently disabled auth when
// its env var was unset — that was a trap.)

import {
  createHmac, createHash, randomBytes, randomUUID,
  scryptSync, timingSafeEqual,
} from 'node:crypto';
import { select } from './supabase.mjs';

const COOKIE = 'df_auth';
const SESSION_DAYS = 90;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

// --- passwords ---------------------------------------------------------

export function hashPassword(password) {
  const salt = randomBytes(32);
  const { N, r, p, keylen } = SCRYPT;
  const hash = scryptSync(password, salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// --- sessions ----------------------------------------------------------

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('No SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY — refusing to run without auth');
  return createHmac('sha256', key).update('deal-finder-session-secret-v1').digest('hex');
}

const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sessionCookie(userId) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = `v1.${userId}.${expires}`;
  const value = `${payload}.${sign(payload)}`;
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearCookie = () =>
  `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

/** Cookie → userId, or null. Throws only if SESSION_SECRET is missing. */
export function readSession(req) {
  const raw = req.headers?.cookie ?? '';
  const match = raw.split(';').map((s) => s.trim().split('='))
    .find(([k]) => k === COOKIE);
  if (!match) return null;
  const parts = match[1].split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [v, userId, expires, sig] = parts;
  if (!safeEqual(sig, sign(`${v}.${userId}.${expires}`))) return null;
  if (Number(expires) * 1000 < Date.now()) return null;
  return userId;
}

// --- user lookup -------------------------------------------------------

const USER_FIELDS = 'id,email,is_admin,created_at,push_token_hash';

/** Session cookie → user row, or null. */
export async function getUser(req) {
  const userId = readSession(req);
  if (!userId) return null;
  const rows = await select('users', `select=${USER_FIELDS}&id=eq.${encodeURIComponent(userId)}`);
  return rows?.[0] ?? null;
}

// --- push tokens -------------------------------------------------------

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');

/** A fresh push token. The token is shown once; only the hash is stored. */
export function newPushToken() {
  const token = `dfp_${randomBytes(32).toString('hex')}`;
  return { token, hash: sha256hex(token) };
}

async function userForToken(req) {
  const header = req.headers?.authorization ?? '';
  const m = header.match(/^Bearer\s+(dfp_[0-9a-f]{64})$/);
  if (!m) return null;
  const hash = sha256hex(m[1]);
  const rows = await select('users', `select=${USER_FIELDS}&push_token_hash=eq.${hash}`);
  const user = rows?.[0] ?? null;
  // Defense in depth: the eq filter already matched, but compare again
  // locally so a PostgREST surprise can't hand back the wrong row.
  return user && safeEqual(user.push_token_hash, hash) ? user : null;
}

// --- guards ------------------------------------------------------------

/** Browser routes: cookie session. Handler receives (req, res, user). */
export function guard(handler) {
  return async (req, res) => {
    let user;
    try {
      user = await getUser(req);
    } catch (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!user) {
      res.status(401).json({ error: 'not authenticated', auth_required: true });
      return;
    }
    return handler(req, res, user);
  };
}

/** Machine routes (push/pull): Authorization: Bearer dfp_... */
export function guardToken(handler) {
  return async (req, res) => {
    let user;
    try {
      user = await userForToken(req);
    } catch (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!user) {
      res.status(401).json({ error: 'invalid or missing push token' });
      return;
    }
    return handler(req, res, user);
  };
}

export { randomUUID };
