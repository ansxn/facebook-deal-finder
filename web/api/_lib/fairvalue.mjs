// Fair-value estimation. Three strategies, because the three categories price on
// completely different things: golf on brand, Pokémon on which set, speakers on
// which exact model.
//
// Every estimate carries a `confidence` and a `basis` string. A number without
// provenance is worse than no number — it looks authoritative and quietly
// poisons the ranking.

const CONDITION_MULTIPLIER = {
  like_new: 1.15,
  sealed: 1.0,
  good: 1.0,
  working: 0.95,
  fair: 0.85,
  untested: 0.6,
  broken: 0.35,
};

export function estimateFairValue(listing, search) {
  const cfg = search.fair_value ?? {};
  const a = listing.assessment ?? {};

  const estimate =
    cfg.method === 'brand_tier' ? byBrandTier(a, cfg)
    : cfg.method === 'per_set_lookup' ? bySetLookup(a, cfg)
    : cfg.method === 'model_lookup' ? byModelLookup(a, cfg)
    : { fmv: null, confidence: 'none', basis: `unknown fair_value.method "${cfg.method}"` };

  if (estimate.fmv == null) return estimate;

  // Condition is applied *relative to what the configured number already means*.
  // A tier value like "$380 for a used major-brand set" is already a typical
  // worn example, not a pristine one — multiplying it by a condition factor
  // outright depreciates an already-depreciated number. `reference_condition`
  // makes that assumption explicit instead of leaving it implied.
  const reference = CONDITION_MULTIPLIER[cfg.reference_condition ?? 'good'] ?? 1.0;
  const mult = (CONDITION_MULTIPLIER[a.condition] ?? reference) / reference;
  const adjusted = applyAdjustments(estimate.fmv * mult, a, cfg.adjustments);

  return {
    ...estimate,
    fmv: Math.round(adjusted.fmv),
    base_fmv: Math.round(estimate.fmv),
    condition_multiplier: mult,
    adjustments: adjusted.applied,
    // A seed number stays a seed number no matter how much math we do to it.
    confidence: cfg.confidence === 'low_seed' ? 'low' : estimate.confidence,
  };
}

function byBrandTier(assessment, cfg) {
  const brand = (assessment.brand ?? '').toLowerCase();
  if (!brand) {
    const fallback = cfg.tiers?.find((t) => t.tier === 'entry') ?? cfg.tiers?.at(-1);
    return fallback
      ? { fmv: fallback.fmv, confidence: 'low', basis: 'no brand identified — assumed entry tier' }
      : { fmv: null, confidence: 'none', basis: 'no brand and no tiers configured' };
  }
  for (const tier of cfg.tiers ?? []) {
    if (tier.brands?.some((b) => brand.includes(b.toLowerCase()))) {
      return { fmv: tier.fmv, confidence: 'medium', basis: `${tier.tier} tier (${brand})` };
    }
  }
  const entry = cfg.tiers?.find((t) => t.tier === 'entry');
  return entry
    ? { fmv: entry.fmv, confidence: 'low', basis: `"${brand}" unrecognized — treated as entry tier` }
    : { fmv: null, confidence: 'none', basis: `"${brand}" matched no tier` };
}

function bySetLookup(assessment, cfg) {
  const key = slug(assessment.set_key ?? assessment.set ?? '');
  const overrides = cfg.set_overrides ?? {};
  if (key) {
    for (const [k, v] of Object.entries(overrides)) {
      if (k.startsWith('_') || typeof v !== 'number') continue;
      if (slug(k) === key || key.includes(slug(k)) || slug(k).includes(key)) {
        return { fmv: v, confidence: 'medium', basis: `set override: ${k}` };
      }
    }
  }
  const dflt = cfg.default_in_print_fmv;
  if (dflt == null) return { fmv: null, confidence: 'none', basis: 'no set match and no default' };
  return {
    fmv: dflt,
    confidence: 'low',
    basis: key ? `no comp for "${key}" — used in-print default` : 'set not identified — used in-print default',
  };
}

function byModelLookup(assessment, cfg) {
  const model = slug(assessment.model ?? '');
  if (model) {
    for (const entry of cfg.models ?? []) {
      if (slug(entry.model) === model || model.includes(slug(entry.model)) || slug(entry.model).includes(model)) {
        return { fmv: entry.used_fmv, confidence: 'high', basis: `known model: ${entry.model}` };
      }
    }
  }
  const newRetail = assessment.new_retail;
  const pct = cfg.unknown_model_fallback?.fmv_pct_of_new_retail;
  if (newRetail && pct) {
    return {
      fmv: newRetail * pct,
      confidence: 'low',
      basis: `unlisted model — ${Math.round(pct * 100)}% of $${newRetail} new retail`,
    };
  }
  return { fmv: null, confidence: 'none', basis: 'model not identified and no retail price to work from' };
}

// Multipliers stack, but not without limit. Three independent-looking penalties
// (worn, old, missing bag) multiplied out to 0.54 of book value, which is below
// what these actually sell for — and an understated fair value quietly hides
// real deals by making them look like fair prices. Anything below FLOOR is a
// sign the tier itself is wrong, not that the item is nearly worthless.
const ADJUSTMENT_FLOOR = 0.65;

/** Returns `{ fmv, applied }` so the dashboard can show which adjustments fired. */
function applyAdjustments(fmv, assessment, adjustments) {
  const applied = [];
  if (!adjustments) return { fmv, applied };
  let multiplier = 1;
  const nice = assessment.nice_to_have ?? {};
  for (const [key, mult] of Object.entries(adjustments)) {
    if (typeof mult !== 'number') continue;
    let fires = false;
    const missing = key.match(/^missing_nice_to_have_(.+)$/);
    if (missing && nice[missing[1]] === false) fires = true;
    // Age thresholds must sit above the category norm. "5+ years old" fired on
    // nearly every listing, so it stopped being an adjustment and became a
    // blanket markdown of the whole tier.
    const age = key.match(/^generation_(\d+)plus_years_old$/);
    if (age && assessment.years_old >= Number(age[1])) fires = true;
    if (key === 'sealed_but_damaged_box' && assessment.box_damaged) fires = true;
    if (fires) { multiplier *= mult; applied.push({ key, multiplier: mult }); }
  }
  const floored = Math.max(multiplier, ADJUSTMENT_FLOOR);
  if (floored !== multiplier) applied.push({ key: 'floor', multiplier: ADJUSTMENT_FLOOR / multiplier, note: `stack floored at ${ADJUSTMENT_FLOOR}` });
  return { fmv: fmv * floored, applied };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
