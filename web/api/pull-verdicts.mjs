// The read half of the sync: `scripts/push.mjs` calls this before pushing so
// a Dismiss tapped on the phone is never overwritten by stale local state.
// Kept separate from /api/push so push stays a pure write.

import { select } from './_lib/supabase.mjs';
import { guardToken } from './_lib/auth.mjs';

export default guardToken(async (req, res, user) => {
  try {
    const rows = (await select(
      'verdicts',
      `select=listing_id,state,updated_at&user_id=eq.${encodeURIComponent(user.id)}`
    )) ?? [];
    res.setHeader('cache-control', 'no-store');
    res.status(200).json({ verdicts: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
