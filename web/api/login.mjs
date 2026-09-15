import { select } from './_lib/supabase.mjs';
import { verifyPassword, sessionCookie } from './_lib/auth.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = req.body?.password;

    const rows = email
      ? await select('users', `select=id,password_hash&email=eq.${encodeURIComponent(email)}`)
      : [];
    const user = rows?.[0];

    // Verify against a dummy hash when the email is unknown so both failure
    // paths cost the same, then add a flat delay to make guessing tedious.
    const ok = user
      ? verifyPassword(password, user.password_hash)
      : (verifyPassword(String(password ?? ''), 'scrypt$16384$8$1$AAAA$AAAA'), false);

    if (!ok) {
      await new Promise((r) => setTimeout(r, 700));
      res.status(401).json({ error: 'Wrong email or password' });
      return;
    }

    res.setHeader('set-cookie', sessionCookie(user.id));
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
