import { upsert, remove } from './_lib/supabase.mjs';
import { guard } from './_lib/auth.mjs';

const ALLOWED = ['seen', 'dismissed', 'saved', 'none'];

export default guard(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const { id, state } = req.body ?? {};
  if (!id || !ALLOWED.includes(state)) {
    res.status(400).json({ error: `need { id, state } where state is one of ${ALLOWED.join(', ')}` });
    return;
  }

  if (state === 'none') {
    await remove('verdicts', `listing_id=eq.${encodeURIComponent(id)}`);
  } else {
    await upsert('verdicts', { listing_id: id, state, updated_at: new Date().toISOString() });
  }

  res.status(200).json({ ok: true, id, state });
});
