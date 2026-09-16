// The read half of config sync: `scripts/pull-config.mjs` (and push.mjs) call
// this so edits made on the website reach the laptop before the next hunt.
// Token-authenticated like pull-verdicts, so no session cookie is needed.

import { select } from './_lib/supabase.mjs';
import { guardToken } from './_lib/auth.mjs';

export default guardToken(async (req, res, user) => {
  try {
    const rows = (await select(
      'config',
      `select=payload,updated_at&key=eq.searches&user_id=eq.${encodeURIComponent(user.id)}`
    )) ?? [];
    res.setHeader('cache-control', 'no-store');
    if (!rows.length) {
      res.status(200).json({ searches: null, updated_at: null });
      return;
    }
    res.status(200).json({ searches: rows[0].payload, updated_at: rows[0].payload?.updated_at ?? rows[0].updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
