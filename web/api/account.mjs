import { update } from './_lib/supabase.mjs';
import { guard, newPushToken, clearCookie } from './_lib/auth.mjs';

export default guard(async (req, res, user) => {
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'GET') {
    res.status(200).json({
      email: user.email,
      is_admin: user.is_admin,
      created_at: user.created_at,
      has_push_token: Boolean(user.push_token_hash),
    });
    return;
  }

  if (req.method === 'POST') {
    const action = req.body?.action;

    if (action === 'regen_token') {
      // Invalidates the old token immediately — only one hash is stored.
      const { token, hash } = newPushToken();
      await update('users', `id=eq.${encodeURIComponent(user.id)}`, { push_token_hash: hash });
      res.status(200).json({
        ok: true,
        push_token: token,
        note: 'Update DEALFINDER_PUSH_TOKEN in .env.local. The old token no longer works.',
      });
      return;
    }

    if (action === 'logout') {
      res.setHeader('set-cookie', clearCookie());
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'unknown action' });
    return;
  }

  res.status(405).json({ error: 'GET or POST' });
});
