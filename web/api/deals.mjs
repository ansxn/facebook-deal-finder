import { loadAll } from './_lib/supabase.mjs';
import { scoreAll, compactDeal } from './_lib/score.mjs';
import { guardEither } from './_lib/auth.mjs';

// Scoring runs here rather than being baked in at write time, so editing your
// searches from the phone re-ranks everything you've ever seen immediately.
//
// Either auth: the dashboard uses a session cookie, /morning-hunt uses a push
// token. ?view=compact trims each deal to what a conversation needs — the full
// shape carries the score breakdown, description and price history, which is
// right for a card and far too much to read back into a chat.
export default guardEither(async (req, res, user) => {
  res.setHeader('cache-control', 'no-store');

  const { listings, verdicts, searches, truncated } = await loadAll(user.id);
  if (!searches) {
    // A brand-new account: setup has not sent its searches yet. Empty, not an error.
    res.status(200).json({ deals: [], searches: [], counts: {}, needs_setup: true });
    return;
  }

  let deals = scoreAll({
    listings,
    searches,
    verdicts,
    includeDismissed: req.query?.dismissed === 'true',
  });

  const counts = deals.reduce((acc, d) => ({ ...acc, [d.status]: (acc[d.status] ?? 0) + 1 }), {});

  const only = req.query?.search;
  if (only) deals = deals.filter((d) => d.search_id === only);

  if (req.query?.view === 'compact') {
    const top = Math.min(Number(req.query?.top) || 10, 50);
    deals = deals.slice(0, top).map(compactDeal);
  }

  res.status(200).json({
    deals,
    searches: searches.searches.map((s) => ({ id: s.id, label: s.label, active: s.active })),
    counts,
    ...(truncated ? { truncated: true } : {}),
  });
});
