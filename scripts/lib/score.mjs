// Deal scoring: how far below fair value, weighted against condition and how
// well the listing matches what you actually asked for.
//
// Scores are always recomputed from stored assessments, never persisted as
// truth. Improving this file re-ranks your entire history instead of only
// affecting listings found after the change.

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

export function scoreListing(listing, search) {
  const a = listing.assessment;
  const price = listing.price;

  // Anything we can't judge yet is "pending", not "bad". Keeping these separate
  // matters: a zero score would bury an un-assessed listing forever.
  if (!a) return pending(listing, 'not assessed yet');
  if (price == null) return pending(listing, 'no price found');

  const dq = disqualify(listing, search, a, price);
  if (dq) return { ...base(listing), status: 'disqualified', reason: dq, score: null, discount_pct: null };

  const fv = estimateFairValue(listing, search);
  if (fv.fmv == null || fv.fmv <= 0) return pending(listing, `no fair value: ${fv.basis}`);

  const discountPct = ((fv.fmv - price) / fv.fmv) * 100;
  const greatAt = search.pricing?.great_deal_pct ?? 35;

  // 1.0 means "hit the great-deal bar". Overshooting is allowed up to 1.2 so
  // genuine steals still outrank merely-good ones, but a 90%-off listing does
  // not get to dominate purely on price — those are usually scams or typos.
  const valueScore = clamp(discountPct / greatAt, -0.5, 1.2);
  const specScore = scoreSpecs(a, search);
  const condScore = CONDITION_SCORE[a.condition] ?? 0.5;

  const raw = WEIGHTS.value * valueScore + WEIGHTS.spec * specScore + WEIGHTS.condition * condScore;
  const score = Math.round(clamp(raw, 0, 1.2) * 100);

  const surfaceAt = search.surface_threshold_pct ?? 20;
  return {
    ...base(listing),
    status: discountPct >= surfaceAt ? 'surface' : 'below_threshold',
    score,
    discount_pct: Math.round(discountPct * 10) / 10,
    fair_value: fv.fmv,
    fair_value_basis: fv.basis,
    fair_value_confidence: fv.confidence,
    components: {
      value: round2(valueScore),
      spec: round2(specScore),
      condition: round2(condScore),
    },
    label: labelFor(discountPct, search),
  };
}

function disqualify(listing, search, a, price) {
  if (a.disqualified) return a.disqualify_reason || 'assessed as disqualified';

  const max = search.pricing?.max;
  if (max != null && price > max) return `$${price} is over your $${max} ceiling`;

  const min = search.filters?.min_price;
  if (min != null && price < min) return `$${price} is below $${min} — almost certainly not the real item`;

  // Spec failures are checked before distance because they're the more useful
  // thing to be told. "No driver" tells you the listing is wrong; "too far"
  // only tells you where it is, and you'd still wonder whether it was any good.
  for (const rule of search.must_have ?? []) {
    if (rule.hard !== true) continue;
    if (a.must_have?.[rule.spec] === false) return `missing required: ${rule.spec.replace(/_/g, ' ')}`;
  }

  // Facebook's radius setting leaks badly — a 65km radius returned listings from
  // Niagara Falls and Norfolk, both well over 100km out. Distance is estimated
  // by the assessor from the listing's town (code can't geocode a place name),
  // and enforced here so a great price two hours away doesn't top the list.
  if (search.max_km != null && a.distance_km != null && a.distance_km > search.max_km) {
    return `~${a.distance_km}km away — past your ${search.max_km}km limit`;
  }

  const accepted = search.condition?.accept;
  if (accepted?.length && a.condition && !accepted.includes(a.condition)) {
    return `condition "${a.condition}" is below your floor`;
  }
  return null;
}

/**
 * Spec match, 0–1. Soft must-haves are the floor of this score; nice-to-haves
 * add on top. Unknown (neither true nor false) counts as half credit rather
 * than zero — Marketplace sellers omit details constantly, and punishing
 * silence as hard as a real "no" throws away most good listings.
 */
function scoreSpecs(a, search) {
  let earned = 0;
  let possible = 0;

  for (const rule of search.must_have ?? []) {
    if (rule.hard === true) continue; // already handled by disqualify()
    possible += 1;
    const v = a.must_have?.[rule.spec];
    earned += v === true ? 1 : v === false ? 0 : 0.5;
  }

  for (const rule of search.nice_to_have ?? []) {
    const w = rule.weight ?? 0.25;
    possible += w;
    const v = a.nice_to_have?.[rule.spec];
    earned += v === true ? w : v === false ? 0 : w * 0.5;
  }

  if (possible === 0) return 1;
  return clamp(earned / possible, 0, 1);
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
const pending = (l, reason) => ({ ...base(l), status: 'pending', reason, score: null, discount_pct: null });
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round2 = (n) => Math.round(n * 100) / 100;

/** Score every listing and return them ranked, with verdicts applied. */
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
      photo: listing.photos?.[0] ?? null,
      location: listing.location ?? null,
      miles: listing.miles ?? null,
      first_seen: listing.first_seen,
      last_seen: listing.last_seen,
      price_history: listing.price_history ?? [],
      assessment: listing.assessment ?? null,
    });
  }

  const rank = { surface: 0, below_threshold: 1, pending: 2, disqualified: 3 };
  scored.sort((a, b) =>
    (rank[a.status] - rank[b.status]) ||
    ((b.score ?? -1) - (a.score ?? -1)) ||
    String(b.first_seen).localeCompare(String(a.first_seen))
  );
  return scored;
}
