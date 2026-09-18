import { loadAll, upsert } from './_lib/supabase.mjs';
import { scoreAll, validateSearches, configNotes } from './_lib/score.mjs';
import { guardEither } from './_lib/auth.mjs';

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

/**
 * What a hunt needs to browse, and nothing else.
 *
 * The valuation tables, penalty multipliers and thresholds are the scorer's
 * business and run on the server; sending them to the browsing session would
 * triple the size of the config for no use. What is left is what shapes the
 * search itself: the terms, the ceiling, the rules to check, the pacing.
 */
function huntView(cfg) {
  const g = cfg.global ?? {};
  return {
    global: {
      currency: g.currency ?? null,
      max_km: g.max_km ?? null,
      read_depth: g.read_depth ?? null,
      pacing: g.pacing ?? {},
      location: {
        resolved: g.location?.resolved ?? null,
        reference_distances: g.location?.reference_distances ?? {},
      },
      field_notes: g.field_notes ?? [],
    },
    searches: (cfg.searches ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      active: s.active !== false,
      queries: s.queries ?? [],
      filters: s.filters ?? {},
      pricing: { max: s.pricing?.max ?? null },
      condition: s.condition ?? {},
      must_have: s.must_have ?? [],
      nice_to_have: s.nice_to_have ?? [],
      dealbreakers: s.dealbreakers ?? [],
      title_style: s.title_style ?? null,
    })),
  };
}

// Either auth: the dashboard calls this with a session cookie, the hunt and
// /hunt-update call it with a push token. One endpoint means config edits get
// the same validation and the same preview counts whichever side makes them.
export default guardEither(async (req, res, user) => {
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'GET') {
    const { searches } = await loadAll(user.id);
    if (!searches) {
      res.status(200).json({ error: 'no config pushed yet' });
      return;
    }
    res.status(200).json(req.query?.view === 'hunt' ? huntView(searches) : searches);
    return;
  }

  // PUT saves the whole config. With ?dry_run=1 it only scores the proposed
  // config against this user's listings and returns the counts, which is what
  // the dashboard's sliders show while you drag, and what /hunt-update uses to
  // say what a change will do before committing it.
  if (req.method === 'PUT') {
    const body = req.body;
    const problems = validateSearches(body);
    if (problems.length) {
      res.status(400).json({ error: problems[0], problems, notes: configNotes(body) });
      return;
    }
    const { listings, verdicts } = await loadAll(user.id);
    const preview = previewCounts(scoreAll({ listings, searches: body, verdicts }));
    const notes = configNotes(body);
    if (req.query?.dry_run === '1') {
      res.status(200).json({ ok: true, dry_run: true, notes, ...preview });
      return;
    }
    const updated_at = new Date().toISOString();
    body.updated_at = updated_at;
    await upsert('config', { user_id: user.id, key: 'searches', payload: body, updated_at });
    res.status(200).json({ ok: true, saved: true, updated_at, notes, ...preview });
    return;
  }

  res.status(405).json({ error: 'GET or PUT' });
});
