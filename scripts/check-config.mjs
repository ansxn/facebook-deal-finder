#!/usr/bin/env node
// Checks searches.json before it is pushed, in words a setup assistant can act
// on, then stamps updated_at so the laptop and website copies sync correctly.
//
//   node scripts/check-config.mjs            check and stamp
//   node scripts/check-config.mjs --no-stamp check only

import { loadSearches, saveSearches } from './lib/store.mjs';
import { validateSearches, PENALTY_DEFAULTS } from './lib/score.mjs';

const cfg = loadSearches();
if (!cfg) {
  console.error('No searches.json yet. Write one first (searches.example.json shows the shape).');
  process.exit(1);
}

const problems = validateSearches(cfg);
const warn = [];
const g = cfg.global ?? {};
if (!g.currency) problems.push('global.currency is missing (e.g. "CAD", "USD")');
if (!g.location?.resolved) problems.push('global.location.resolved is missing: the city listings are measured from');
if (g.max_km == null) problems.push('global.max_km is missing: how far the user will travel');
if (!g.pacing?.min_hours_between_runs) problems.push('global.pacing is missing: copy it from searches.example.json unchanged');
if (g.pacing?.abort_on_checkpoint !== true) problems.push('global.pacing.abort_on_checkpoint must be true');

for (const s of cfg.searches ?? []) {
  const name = s.label || s.id || '(unnamed)';
  if (!/^[a-z0-9-]+$/.test(s.id ?? '')) problems.push(`${name}: id must be lowercase letters, numbers and dashes`);
  if (!s.label) problems.push(`${name}: needs a label`);
  if (s.pricing?.max == null) problems.push(`${name}: pricing.max (ceiling) is missing`);
  if (s.pricing?.great_deal_pct == null || s.pricing?.good_deal_pct == null) problems.push(`${name}: pricing.good_deal_pct and great_deal_pct are needed`);
  if (!s.condition?.accept?.length) problems.push(`${name}: condition.accept needs at least one condition`);
  if (!s.title_style) warn.push(`${name}: no title_style, listing names will be the seller's own`);
  if (!(s.dealbreakers ?? []).length) warn.push(`${name}: no dealbreakers`);

  const fv = s.fair_value ?? {};
  if (!fv.basis) problems.push(`${name}: fair_value.basis should say where the numbers came from`);
  if (fv.method === 'brand_tier') {
    if (!(fv.tiers ?? []).length) problems.push(`${name}: brand_tier needs fair_value.tiers`);
    if (!(fv.tiers ?? []).some(t => t.tier === 'entry')) problems.push(`${name}: brand_tier needs a tier named "entry" for unbranded listings`);
    for (const t of fv.tiers ?? []) if (!(t.fmv > 0)) problems.push(`${name}: tier "${t.tier}" needs a positive fmv`);
  } else if (fv.method === 'per_set_lookup') {
    if (!(fv.default_in_print_fmv > 0)) problems.push(`${name}: per_set_lookup needs default_in_print_fmv`);
  } else if (fv.method === 'model_lookup') {
    if (!(fv.models ?? []).length) problems.push(`${name}: model_lookup needs fair_value.models`);
    for (const m of fv.models ?? []) if (!m.model || !(m.used_fmv > 0)) problems.push(`${name}: every model needs a name and a positive used_fmv`);
    if (!fv.unknown_model_fallback?.fmv_pct_of_new_retail) warn.push(`${name}: no unknown_model_fallback, unlisted models will stay unscored`);
  } else {
    problems.push(`${name}: fair_value.method must be brand_tier, per_set_lookup or model_lookup`);
  }
  for (const k of Object.keys(s.penalties ?? {})) if (!(k in PENALTY_DEFAULTS)) problems.push(`${name}: unknown penalty "${k}"`);
}

for (const w of warn) console.log(`note: ${w}`);
if (problems.length) {
  for (const p of problems) console.error(`fix: ${p}`);
  process.exit(1);
}
if (!process.argv.includes('--no-stamp')) {
  cfg.updated_at = new Date().toISOString();
  saveSearches(cfg);
}
console.log(`ok: ${cfg.searches.length} search${cfg.searches.length === 1 ? '' : 'es'} ready to push`);
