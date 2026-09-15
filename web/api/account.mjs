import { update, select } from './_lib/supabase.mjs';
import { guard, newPushToken, clearCookie, verifyPassword, hashPassword } from './_lib/auth.mjs';

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

    if (action === 'change_password') {
      const { current, next } = req.body ?? {};
      if (typeof next !== 'string' || next.length < 10 || next.length > 200) {
        res.status(400).json({ error: 'New password must be at least 10 characters' });
        return;
      }
      // The guard's user object doesn't carry the hash — fetch it fresh so a
      // stale session can't skip the current-password check.
      const rows = await select('users', `select=password_hash&id=eq.${encodeURIComponent(user.id)}`);
      if (!verifyPassword(current, rows?.[0]?.password_hash)) {
        await new Promise((r) => setTimeout(r, 700));
        res.status(401).json({ error: 'Current password is wrong' });
        return;
      }
      await update('users', `id=eq.${encodeURIComponent(user.id)}`, { password_hash: hashPassword(next) });
      res.status(200).json({ ok: true });
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
