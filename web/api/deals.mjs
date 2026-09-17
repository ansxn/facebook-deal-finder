import { loadAll } from './_lib/supabase.mjs';
import { scoreAll } from './_lib/score.mjs';
import { guard } from './_lib/auth.mjs';

// Scoring runs here rather than being baked in at push time, so editing your
// searches from the phone re-ranks everything you've ever seen immediately —
// same behaviour as locally.
export default guard(async (req, res, user) => {
  const { listings, verdicts, searches } = await loadAll(user.id);
  if (!searches) {
    // A brand-new account: setup has not sent its searches yet. Empty, not an error.
    res.setHeader('cache-control', 'no-store');
    res.status(200).json({ deals: [], searches: [], counts: {}, needs_setup: true });
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
