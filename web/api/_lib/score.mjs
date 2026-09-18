// Deal scoring: how far below fair value, weighted against condition and how
// well the listing matches what you actually asked for.
//
// Scores are always recomputed from stored assessments, never persisted as
// truth. Improving this file re-ranks your entire history instead of only
// affecting listings found after the change.
//
// Nothing is auto-rejected. A listing that fails a rule — over your ceiling,
// too far, missing a hard must-have, an assessor dealbreaker — still gets a
// score; the failure becomes a visible, explained penalty that pushes it down
// the ranking. Only the user's own Pass removes something from view. Every
// result carries a `breakdown` so the dashboard can show exactly why.

import { estimateFairValue } from './fairvalue.mjs';

const WEIGHTS = { value: 0.6, spec: 0.25, condition: 0.15 };

// Deliberately shallow between like_new and fair. Fair value already applies a
// condition multiplier, so grading wear steeply here too would penalize the same
// fact twice — which buried complete, correctly-priced, well-worn sets beneath
// pristine-but-unverified ones. What this component is really for is *risk*:
// untested and broken are the steep drops, because those are gambles rather
// than just used.
const CONDITION_SCORE = {
  like_new: 1.0, sealed: 1.0, good: 0.95, working: 0.85,
  fair: 0.85, untested: 0.35, broken: 0.15,
};

// Penalty multipliers on the final score. Ordered by how much they should hurt:
// an assessor dealbreaker (wrong handedness, kids' set) is nearly a no; a price
// over your ceiling is a maybe-negotiate.
const PENALTY = {
  dealbreaker: 0.25,
  missing_hard_must_have: 0.4,
  below_min_price: 0.4,
  over_ceiling: 0.5,
  too_far: 0.6,
  condition_below_floor: 0.7,
};

export function scoreListing(listing, search) {
  const a = listing.assessment;
  const price = listing.price;

  // Anything we can't judge yet is "pending", not "bad". Keeping these separate
  // matters: a zero score would bury an un-assessed listing forever.
  if (!a) return pending(listing, search, 'not assessed yet');
  if (price == null) return pending(listing, search, 'no price found');

  const fv = estimateFairValue(listing, search);
  if (fv.fmv == null || fv.fmv <= 0) return pending(listing, search, `no fair value: ${fv.basis}`);

  const discountPct = ((fv.fmv - price) / fv.fmv) * 100;
  const greatAt = search.pricing?.great_deal_pct ?? 35;

  // 1.0 means "hit the great-deal bar". Overshooting is allowed up to 1.2 so
  // genuine steals still outrank merely-good ones, but a 90%-off listing does
  // not get to dominate purely on price — those are usually scams or typos.
  const valueScore = clamp(discountPct / greatAt, -0.5, 1.2);
  const spec = scoreSpecs(a, search);
  const condScore = CONDITION_SCORE[a.condition] ?? 0.5;

  const raw = clamp(
    WEIGHTS.value * valueScore + WEIGHTS.spec * spec.score + WEIGHTS.condition * condScore,
    0, 1.2
  );
  const flags = penalties(search, a, price);
  const penaltyMult = flags.reduce((m, f) => m * f.multiplier, 1);
  const score = Math.round(raw * penaltyMult * 100);

  const surfaceAt = search.surface_threshold_pct ?? 20;
  return {
    ...base(listing, search),
    status: flags.length === 0 && discountPct >= surfaceAt ? 'surface' : 'ranked',
    score,
    discount_pct: Math.round(discountPct * 10) / 10,
    fair_value: fv.fmv,
    fair_value_basis: fv.basis,
    fair_value_confidence: fv.confidence,
    label: labelFor(discountPct, search),
    flags,
    components: { value: round2(valueScore), spec: round2(spec.score), condition: round2(condScore) },
    breakdown: {
      raw: round2(raw),
      penalty_multiplier: round2(penaltyMult),
      final: score,
      surface_threshold_pct: surfaceAt,
      value: {
        score: round2(valueScore), weight: WEIGHTS.value,
        discount_pct: Math.round(discountPct * 10) / 10,
        great_deal_pct: greatAt,
        fair_value: fv.fmv, base_fmv: fv.base_fmv ?? null,
        condition_multiplier: fv.condition_multiplier ?? null,
        adjustments: fv.adjustments ?? [],
        basis: fv.basis, confidence: fv.confidence,
      },
      spec: { score: round2(spec.score), weight: WEIGHTS.spec, checks: spec.checks },
      condition: { score: round2(condScore), weight: WEIGHTS.condition, condition: a.condition ?? null },
      penalties: flags,
    },
  };
}

/**
 * Rule failures as penalties. Each entry explains itself in plain words —
 * the text is what the user reads on the card and in the detail sheet.
 */
function penalties(search, a, price) {
  const out = [];
  // Per-search overrides let the user soften a rule from the dashboard without
  // waiting for a re-assessment: 1 means "no penalty at all".
  const mult = (key) => {
    const v = Number(search.penalties?.[key]);
    return Number.isFinite(v) ? clamp(v, 0.05, 1) : PENALTY[key];
  };
  const add = (code, text, key = code) => out.push({ code, text, multiplier: mult(key) });

  if (a.disqualified) add('dealbreaker', a.disqualify_reason || 'assessed as a dealbreaker');

  const max = search.pricing?.max;
  if (max != null && price > max) add('over_ceiling', `over your $${max} ceiling by $${price - max}`);

  const min = search.filters?.min_price;
  if (min != null && price < min) add('below_min_price', `$${price} is below your $${min} minimum, probably not the real item`);

  // Spec failures come before distance because they're the more useful thing
  // to be told: "no driver" says the listing is wrong; "too far" only says
  // where it is.
  for (const rule of search.must_have ?? []) {
    if (rule.hard !== true) continue;
    if (a.must_have?.[rule.spec] === false) {
      add(`missing_hard_must_have:${rule.spec}`, `fails must-have: ${rule.spec.replace(/_/g, ' ')}`, 'missing_hard_must_have');
    }
  }

  // Facebook's radius setting leaks badly — a 65km radius returned listings from
  // Niagara Falls and Norfolk, both well over 100km out. Distance is estimated
  // by the assessor from the listing's town (code can't geocode a place name).
  if (search.max_km != null && a.distance_km != null && a.distance_km > search.max_km) {
    add('too_far', `~${a.distance_km} km away, past your ${search.max_km} km limit`);
  }

  const accepted = search.condition?.accept;
  if (accepted?.length && a.condition && !accepted.includes(a.condition)) {
    add('condition_below_floor', `condition "${a.condition}" is below your floor`);
  }
  return out;
}

/**
 * Spec match, 0–1, plus the per-spec checklist behind it. Soft must-haves are
 * the floor of this score; nice-to-haves add on top. Unknown (neither true nor
 * false) counts as half credit rather than zero — Marketplace sellers omit
 * details constantly, and punishing silence as hard as a real "no" throws away
 * most good listings. Hard must-haves are listed but scored by penalties().
 */
function scoreSpecs(a, search) {
  let earned = 0;
  let possible = 0;
  const checks = [];

  for (const rule of search.must_have ?? []) {
    const v = a.must_have?.[rule.spec] ?? null;
    checks.push({ spec: rule.spec, kind: 'must', hard: rule.hard === true, weight: 1, value: v, test: rule.test ?? null });
    if (rule.hard === true) continue; // penalised, not scored
    possible += 1;
    earned += v === true ? 1 : v === false ? 0 : 0.5;
  }

  for (const rule of search.nice_to_have ?? []) {
    const w = rule.weight ?? 0.25;
    const v = a.nice_to_have?.[rule.spec] ?? null;
    checks.push({ spec: rule.spec, kind: 'nice', hard: false, weight: w, value: v, test: rule.test ?? null });
    possible += w;
    earned += v === true ? w : v === false ? 0 : w * 0.5;
  }

  return { score: possible === 0 ? 1 : clamp(earned / possible, 0, 1), checks };
}

function labelFor(discountPct, search) {
  const great = search.pricing?.great_deal_pct ?? 35;
  const good = search.pricing?.good_deal_pct ?? 20;
  if (discountPct >= great) return 'steal';
  if (discountPct >= good) return 'good deal';
  if (discountPct >= 0) return 'fair price';
  return 'overpriced';
}

export const PENALTY_DEFAULTS = { ...PENALTY };
export const CONDITIONS = Object.keys(CONDITION_SCORE);

/**
 * Sanity checks shared by the local server and the hosted API before a config
 * is written. Returns a list of plain-English problems; empty means fine.
 */
export function validateSearches(cfg) {
  const errs = [];
  if (!cfg || typeof cfg !== 'object') return ['config must be an object'];
  if (!Array.isArray(cfg.searches) || !cfg.searches.length) return ['at least one search is required'];
  const g = cfg.global ?? {};
  const pct = (v, name, lo = 0, hi = 95) => { if (v != null && !(Number(v) >= lo && Number(v) <= hi)) errs.push(`${name} must be between ${lo} and ${hi}`); };
  pct(g.surface_threshold_pct, 'worth-a-look threshold', 0, 90);
  if (g.max_km != null && !(Number(g.max_km) > 0)) errs.push('max distance must be above 0 km');
  const seen = new Set();
  for (const s of cfg.searches) {
    const name = s.label || s.id || '(unnamed)';
    if (!s.id) errs.push(`${name}: missing id`);
    if (seen.has(s.id)) errs.push(`${name}: duplicate id`);
    seen.add(s.id);
    if (!Array.isArray(s.queries) || !s.queries.filter(Boolean).length) errs.push(`${name}: needs at least one search term`);
    const p = s.pricing ?? {};
    pct(p.good_deal_pct, `${name}: good-deal %`); pct(p.great_deal_pct, `${name}: steal %`);
    if (p.good_deal_pct != null && p.great_deal_pct != null && Number(p.good_deal_pct) > Number(p.great_deal_pct)) errs.push(`${name}: good-deal % can’t be above steal %`);
    const min = s.filters?.min_price;
    if (p.max != null && min != null && Number(p.max) <= Number(min)) errs.push(`${name}: ceiling must be above the minimum price`);
    for (const r of s.must_have ?? []) if (!r.spec) errs.push(`${name}: a must-have has no name`);
    for (const r of s.nice_to_have ?? []) {
      if (!r.spec) errs.push(`${name}: a nice-to-have has no name`);
      if (r.weight != null && !(Number(r.weight) >= 0 && Number(r.weight) <= 1)) errs.push(`${name}: nice-to-have weights go from 0 to 1`);
    }
    for (const [k, v] of Object.entries(s.penalties ?? {})) {
      if (!(k in PENALTY)) errs.push(`${name}: unknown penalty "${k}"`);
      else if (!(Number(v) >= 0.05 && Number(v) <= 1)) errs.push(`${name}: penalty "${k}" must be between 0.05 and 1`);
    }

    if (!/^[a-z0-9-]+$/.test(s.id ?? '')) errs.push(`${name}: id must be lowercase letters, numbers and dashes`);
    if (!s.label) errs.push(`${name}: needs a label`);
    if (p.max == null) errs.push(`${name}: a price ceiling is required`);
    if (p.good_deal_pct == null || p.great_deal_pct == null) errs.push(`${name}: good-deal % and steal % are both required`);
    if (!s.condition?.accept?.length) errs.push(`${name}: at least one acceptable condition is required`);

    const fv = s.fair_value ?? {};
    if (!fv.basis) errs.push(`${name}: fair_value.basis should say where the numbers came from`);
    if (fv.method === 'brand_tier') {
      if (!(fv.tiers ?? []).length) errs.push(`${name}: brand_tier needs fair_value.tiers`);
      if (!(fv.tiers ?? []).some((t) => t.tier === 'entry')) errs.push(`${name}: brand_tier needs a tier named "entry" for unbranded listings`);
      for (const t of fv.tiers ?? []) if (!(t.fmv > 0)) errs.push(`${name}: tier "${t.tier}" needs a positive fmv`);
    } else if (fv.method === 'per_set_lookup') {
      if (!(fv.default_in_print_fmv > 0)) errs.push(`${name}: per_set_lookup needs default_in_print_fmv`);
    } else if (fv.method === 'model_lookup') {
      if (!(fv.models ?? []).length) errs.push(`${name}: model_lookup needs fair_value.models`);
      for (const m of fv.models ?? []) if (!m.model || !(m.used_fmv > 0)) errs.push(`${name}: every model needs a name and a positive used_fmv`);
    } else {
      errs.push(`${name}: fair_value.method must be brand_tier, per_set_lookup or model_lookup`);
    }
  }

  if (!g.currency) errs.push('currency is missing (e.g. "CAD", "USD")');
  if (!g.location?.resolved) errs.push('location is missing: the city listings are measured from');
  if (g.max_km == null) errs.push('max distance is missing: how far you will travel');
  if (!g.pacing?.min_hours_between_runs) errs.push('pacing is missing: copy it from searches.example.json unchanged');
  if (g.pacing?.abort_on_checkpoint !== true) errs.push('pacing.abort_on_checkpoint must be true');
  for (const [town, km] of Object.entries(g.location?.reference_distances ?? {})) {
    if (!(Number(km) > 0)) errs.push(`reference distance for "${town}" must be a positive number of km`);
  }
  for (const n of g.field_notes ?? []) {
    if (typeof n !== 'string' || n.length > 300) errs.push('each field note must be text under 300 characters');
  }
  return errs;
}

/**
 * Advisory only: things worth saying out loud that should never block a save.
 * A config can be perfectly valid and still be about to disappoint you.
 */
export function configNotes(cfg) {
  const notes = [];
  if (!cfg || typeof cfg !== 'object') return notes;
  const g = cfg.global ?? {};

  const towns = Object.keys(g.location?.reference_distances ?? {}).length;
  if (!towns) notes.push('no reference distances set, so every listing will be assessed without knowing how far away it is');
  else if (towns < 8) notes.push(`only ${towns} reference distances — listings from towns not on the list get a rough guess`);

  for (const s of cfg.searches ?? []) {
    const name = s.label || s.id || '(unnamed)';
    if (!s.title_style) notes.push(`${name}: no title style, so listings keep the seller's own wording`);
    if (!(s.dealbreakers ?? []).length) notes.push(`${name}: no dealbreakers set`);
    if (s.fair_value?.method === 'model_lookup' && !s.fair_value?.unknown_model_fallback?.fmv_pct_of_new_retail) {
      notes.push(`${name}: no fallback for unlisted models, so those stay unscored`);
    }
  }
  return notes;
}

const base = (l, search) => ({ id: l.id, search_id: l.search_id, title: l.title, display_title: displayTitle(l, search), price: l.price });

/**
 * The name shown on the dashboard. The assessor writes `display_title` during
 * a hunt (brand and model first, the facts the rules care about, no marketing).
 * Listings that predate that get a code cleanup of the seller's title so the
 * board still reads uniformly: caps, emoji and hype stripped, hand and flex
 * spelled out, brand prefixed when the assessor found one the title lacks.
 */
const HYPE = /\b(must ?see|wow|great deal|amazing|excellent deal|cheap|obo|o\.b\.o\.?|firm|no lowballs?|serious (buyers|inquiries) only|pick ?up only|cash only|look!*)\b/gi;
const KEEP_CAPS = new Set(['RH', 'LH', 'ETB', 'TCG', 'DCI', 'SX', 'RS2', 'TPS', 'YU4', 'YU6', 'XJ', 'PW', 'SW', 'LW', 'GW', 'AW', 'DFX', 'X22']);
export function displayTitle(l, search) {
  const custom = l.assessment?.display_title;
  if (custom && String(custom).trim()) return String(custom).trim();
  let t = String(l.title ?? '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ').replace(/[!*]+/g, ' ').replace(HYPE, ' ');
  t = t.replace(/[\s\-–—|]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  t = t.split(' ').map(w => (w.length > 3 && w === w.toUpperCase() && !KEEP_CAPS.has(w) && /^[A-Z'’]+$/.test(w)) ? w[0] + w.slice(1).toLowerCase() : w).join(' ');
  t = t.replace(/\(\s*(men'?s|ladies|women'?s)?\s*(right|left)[- ]handed?\s*\)/gi, (m, who, hand) => `, ${hand.toLowerCase()}-handed`)
       .replace(/\bR\/?H\b/g, 'right-handed').replace(/\bL\/?H\b/g, 'left-handed');
  t = t.replace(/\s*\/\s*(right|left)[- ]handed?\b/gi, (m, hand) => `, ${hand.toLowerCase()}-handed`);
  const brand = l.assessment?.brand, model = l.assessment?.model;
  const lead = [brand, model].filter(x => x && !t.toLowerCase().includes(String(x).toLowerCase())).join(' ');
  if (lead) t = `${lead} ${t}`;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t.replace(/\s+,/g, ',').replace(/,\s*,/g, ',').trim();
  if (t.length > 72) t = t.slice(0, 70).replace(/\s\S*$/, '') + '…';
  return t || 'Untitled';
}
const pending = (l, search, reason) => ({ ...base(l, search), status: 'pending', reason, score: null, discount_pct: null, flags: [] });
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round2 = (n) => Math.round(n * 100) / 100;

/** Score every listing and return them ranked, with verdicts and ranks applied. */
export function scoreAll({ listings, searches, verdicts = {}, includeDismissed = false }) {
  const byId = Object.fromEntries(searches.searches.map((s) => [s.id, s]));
  const globalThreshold = searches.global?.surface_threshold_pct;

  const scored = [];
  for (const listing of Object.values(listings.listings ?? {})) {
    const search = byId[listing.search_id];
    if (!search) continue;
    const result = scoreListing(listing, {
      ...search,
      surface_threshold_pct: globalThreshold ?? search.surface_threshold_pct,
      max_km: searches.global?.max_km ?? search.max_km,
    });
    const verdict = verdicts[listing.id]?.state ?? null;
    if (verdict === 'dismissed' && !includeDismissed) continue;
    scored.push({
      ...result,
      verdict,
      url: listing.url,
      location: listing.location ?? null,
      miles: listing.miles ?? null,
      description: listing.description ?? null,
      seller: listing.seller ?? null,
      posted: listing.posted ?? null,
      first_seen: listing.first_seen,
      last_seen: listing.last_seen,
      price_history: listing.price_history ?? [],
      assessment: listing.assessment ?? null,
    });
  }

  // Attractiveness order: scored listings by score, pending last, newest first
  // within ties. Passed (dismissed) listings keep their rank slot so "bring
  // back" doesn't reshuffle everything, but they're excluded above by default.
  scored.sort((a, b) =>
    ((b.score ?? -1) - (a.score ?? -1)) ||
    String(b.first_seen).localeCompare(String(a.first_seen))
  );

  const perSearch = {};
  scored.forEach((d, i) => {
    d.rank = i + 1;
    perSearch[d.search_id] = (perSearch[d.search_id] ?? 0) + 1;
    d.rank_in_search = perSearch[d.search_id];
  });
  for (const d of scored) d.total_in_search = perSearch[d.search_id];
  return scored;
}

/**
 * A scored listing trimmed to what a conversation needs to describe it.
 *
 * The full object carries the score breakdown, the description, the whole price
 * history and the raw assessment — right for the dashboard, and far too much to
 * read back into a chat after every search.
 */
export const compactDeal = (d) => ({
  rank_in_search: d.rank_in_search,
  id: d.id,
  search_id: d.search_id,
  title: d.display_title ?? d.title,
  price: d.price,
  score: d.score,
  status: d.status,
  label: d.label ?? null,
  discount_pct: d.discount_pct,
  fair_value: d.fair_value ?? null,
  fair_value_confidence: d.fair_value_confidence ?? null,
  flags: (d.flags ?? []).map((f) => ({ code: f.code, text: f.text })),
  verdict: d.verdict ?? null,
  first_seen: d.first_seen,
  url: d.url,
});
