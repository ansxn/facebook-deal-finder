// Password gate for the hosted dashboard.
//
// One shared password, not user accounts — this is a single-person tool and a
// login system would be more attack surface than it removes. But it is not
// optional: without it, your location, what you're hunting, and everything
// you've saved sit on a public URL.
//
// The cookie is an HMAC of a fixed string keyed by the password, so it can be
// verified without storing sessions anywhere. Changing DASHBOARD_PASSWORD
// invalidates every existing cookie for free.

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'df_auth';

export const authRequired = () => Boolean(process.env.DASHBOARD_PASSWORD);

const tokenFor = (password) =>
  createHmac('sha256', password).update('deal-finder-auth-v1').digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function isAuthed(req) {
  if (!authRequired()) return true;
  const raw = req.headers?.cookie ?? '';
  const match = raw.split(';').map((s) => s.trim().split('='))
    .find(([k]) => k === COOKIE);
  return Boolean(match) && safeEqual(match[1], tokenFor(process.env.DASHBOARD_PASSWORD));
}

export function checkPassword(candidate) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected || typeof candidate !== 'string') return false;
  // Compare hashes rather than raw values so a wrong-length guess doesn't leak
  // the password's length through the comparison.
  return safeEqual(tokenFor(candidate), tokenFor(expected));
}

export function sessionCookie() {
  const value = tokenFor(process.env.DASHBOARD_PASSWORD);
  // httpOnly so page scripts can't read it; SameSite=Lax so it survives a normal
  // navigation from a link but not a cross-site POST.
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 90}`;
}

/** Wraps a handler so every route is gated by default rather than by memory. */
export function guard(handler) {
  return async (req, res) => {
    if (!isAuthed(req)) {
      res.status(401).json({ error: 'not authenticated', auth_required: true });
      return;
    }
    return handler(req, res);
  };
}
