import { loadAll, upsert } from './_lib/supabase.mjs';
import { scoreAll, validateSearches } from './_lib/score.mjs';
import { guard } from './_lib/auth.mjs';

// Headline numbers for a config: how many listings it would surface, per hunt.
function previewCounts(scored) {
  const by = {};
  for (const d of scored) {
    by[d.search_id] = by[d.search_id] ?? { surface: 0, total: 0 };
    by[d.search_id].total++;
    if (d.status === 'surface') by[d.search_id].surface++;
  }
  return {
    surface: scored.filter((d) => d.status === 'surface').length,
    ranked: scored.filter((d) => d.status === 'ranked').length,
    pending: scored.filter((d) => d.status === 'pending').length,
    by_search: by,
  };
}

export default guard(async (req, res, user) => {
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'GET') {
    const { searches } = await loadAll(user.id);
    res.status(200).json(searches ?? { error: 'no config pushed yet' });
    return;
  }

  // PUT saves the whole config. With ?dry_run=1 it only scores the proposed
  // config against this user's listings and returns the counts, which is what
  // the dashboard's sliders show while you drag.
  if (req.method === 'PUT') {
    const body = req.body;
    const problems = validateSearches(body);
    if (problems.length) {
      res.status(400).json({ error: problems[0], problems });
      return;
    }
    const { listings, verdicts } = await loadAll(user.id);
    const preview = previewCounts(scoreAll({ listings, searches: body, verdicts }));
    if (req.query?.dry_run === '1') {
      res.status(200).json({ ok: true, dry_run: true, ...preview });
      return;
    }
    const updated_at = new Date().toISOString();
    body.updated_at = updated_at;
    await upsert('config', { user_id: user.id, key: 'searches', payload: body, updated_at });
    // scripts/push.mjs and scripts/pull-config.mjs pull this copy down before
    // the next hunt when it is newer than the laptop's searches.json.
    res.status(200).json({ ok: true, saved: true, updated_at, ...preview });
    return;
  }

  res.status(405).json({ error: 'GET or PUT' });
});
