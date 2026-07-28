import { checkPassword, sessionCookie, authRequired } from './_lib/auth.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  if (!authRequired()) {
    res.status(200).json({ ok: true, note: 'no password configured — dashboard is open' });
    return;
  }

  const password = req.body?.password;
  if (!checkPassword(password)) {
    // A flat delay on failure: it costs nothing at one user and makes guessing
    // through a serverless endpoint tedious.
    await new Promise((r) => setTimeout(r, 700));
    res.status(401).json({ error: 'Wrong password' });
    return;
  }

  res.setHeader('set-cookie', sessionCookie());
  res.status(200).json({ ok: true });
}
