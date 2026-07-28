import { loadAll, upsert } from './_lib/supabase.mjs';
import { guard } from './_lib/auth.mjs';

export default guard(async (req, res) => {
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'GET') {
    const { searches } = await loadAll();
    res.status(200).json(searches ?? { error: 'no config pushed yet' });
    return;
  }

  if (req.method === 'PUT') {
    const body = req.body;
    if (!body?.searches?.length) {
      res.status(400).json({ error: 'refusing to save a config with no searches' });
      return;
    }
    await upsert('config', { key: 'searches', payload: body, updated_at: new Date().toISOString() });
    // Note this only changes the hosted copy. The next `node scripts/push.mjs`
    // pushes the local searches.json back up and overwrites it — edit in one
    // place or the other, not both between runs.
    res.status(200).json({ ok: true, note: 'saved to the hosted config' });
    return;
  }

  res.status(405).json({ error: 'GET or PUT' });
});
