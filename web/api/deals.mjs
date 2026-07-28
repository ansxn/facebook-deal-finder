import { loadAll } from './_lib/supabase.mjs';
import { scoreAll } from './_lib/score.mjs';
import { guard } from './_lib/auth.mjs';

// Scoring runs here rather than being baked in at push time, so editing your
// searches from the phone re-ranks everything you've ever seen immediately —
// same behaviour as locally.
export default guard(async (req, res) => {
  const { listings, verdicts, searches } = await loadAll();
  if (!searches) {
    res.status(503).json({ error: 'No searches config in the database yet. Run: node scripts/push.mjs' });
    return;
  }

  const deals = scoreAll({
    listings,
    searches,
    verdicts,
    includeDismissed: req.query?.dismissed === 'true',
  });

  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    deals,
    searches: searches.searches.map((s) => ({ id: s.id, label: s.label, active: s.active })),
    counts: deals.reduce((acc, d) => ({ ...acc, [d.status]: (acc[d.status] ?? 0) + 1 }), {}),
  });
});
