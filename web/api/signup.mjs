// Open self-signup, with guardrails sized for "friends of the owner", not
// "the public internet": a hard user cap, an optional invite code, a
// kill-switch, and a flat delay on every failure path so probing through a
// serverless endpoint stays tedious.

import { upsert, select } from './_lib/supabase.mjs';
import { hashPassword, sessionCookie, newPushToken, randomUUID } from './_lib/auth.mjs';

const MAX_USERS = Number(process.env.MAX_USERS ?? 25);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = async (res, status, error) => {
  await new Promise((r) => setTimeout(r, 700));
  res.status(status).json({ error });
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  if (process.env.SIGNUP_DISABLED) {
    await fail(res, 403, 'Signups are currently disabled');
    return;
  }

  const { email: rawEmail, password, code } = req.body ?? {};
  if (process.env.SIGNUP_CODE && code !== process.env.SIGNUP_CODE) {
    await fail(res, 403, 'This instance requires an invite code');
    return;
  }

  const email = String(rawEmail ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    await fail(res, 400, 'That does not look like an email address');
    return;
  }
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
    await fail(res, 400, 'Password must be at least 10 characters');
    return;
  }

  try {
    const existing = (await select('users', 'select=id')) ?? [];
    if (existing.length >= MAX_USERS) {
      await fail(res, 403, 'This instance is full — ask the owner to raise MAX_USERS');
      return;
    }

    const { token, hash } = newPushToken();
    const user = {
      id: randomUUID(),
      email,
      password_hash: hashPassword(password),
      push_token_hash: hash,
    };
    await upsert('users', user);

    res.setHeader('set-cookie', sessionCookie(user.id));
    res.status(200).json({
      ok: true,
      email,
      // Shown exactly once — only its hash is stored.
      push_token: token,
      note: 'Save the push token into .env.local as DEALFINDER_PUSH_TOKEN. It will not be shown again.',
    });
  } catch (err) {
    if (/409|duplicate|unique/i.test(err.message)) {
      await fail(res, 400, 'That email is already registered');
      return;
    }
    res.status(500).json({ error: err.message });
  }
}
