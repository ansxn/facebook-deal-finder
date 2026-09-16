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
  if (!a) return pending(listing, 'not assessed yet');
  if (price == null) return pending(listing, 'no price found');

  const fv = estimateFairValue(listing, search);
  if (fv.fmv == null || fv.fmv <= 0) return pending(listing, `no fair value: ${fv.basis}`);

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
    ...base(listing),
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
  const add = (code, text, key = code) => out.push({ code, text, multiplier: PENALTY[key] });

  if (a.disqualified) add('dealbreaker', a.disqualify_reason || 'assessed as a dealbreaker');

  const max = search.pricing?.max;
  if (max != null && price > max) add('over_ceiling', `over your $${max} ceiling by $${price - max}`);

  const min = search.filters?.min_price;
  if (min != null && price < min) add('below_min_price', `$${price} is below $${min} — almost certainly not the real item`);

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

const base = (l) => ({ id: l.id, search_id: l.search_id, title: l.title, price: l.price });
const pending = (l, reason) => ({ ...base(l), status: 'pending', reason, score: null, discount_pct: null, flags: [] });
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
