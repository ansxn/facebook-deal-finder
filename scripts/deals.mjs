#!/usr/bin/env node
// The ranking in the terminal — the same scoring the dashboard uses, minus the
// dashboard. Useful for checking scoring changes without a browser.
//
//   node scripts/deals.mjs                 top 10 per search, with flags
//   node scripts/deals.mjs --all           every listing, including passed ones
//   node scripts/deals.mjs --search golf-complete-sets
//   node scripts/deals.mjs --json
//
// Nothing is hidden by rules: a listing over your ceiling or missing a
// must-have still appears, ranked low, with the reason in brackets.

import { loadListings, loadSearches, loadVerdicts } from './lib/store.mjs';
import { scoreAll } from './lib/score.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => args[args.indexOf(f) + 1];
const TOP = has('--all') ? Infinity : Number(val('--top') ?? 10);

const searches = loadSearches();
if (!searches) { console.error('searches.json not found'); process.exit(1); }

let scored = scoreAll({
  listings: loadListings(),
  searches,
  verdicts: loadVerdicts(),
  includeDismissed: has('--all'),
});

if (has('--search')) scored = scored.filter((d) => d.search_id === val('--search'));

if (has('--json')) {
  console.log(JSON.stringify(scored, null, 2));
  process.exit(0);
}

if (!scored.length) {
  console.log('No listings stored yet — run a browse first.');
  process.exit(0);
}

const C = { dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m' };
const color = (d) =>
  d.status === 'pending' ? C.dim
  : d.flags?.length ? C.red
  : d.label === 'steal' ? C.green
  : d.label === 'good deal' ? C.yellow
  : '';

for (const s of searches.searches) {
  const list = scored.filter((d) => d.search_id === s.id);
  if (!list.length) continue;
  const worth = list.filter((d) => d.status === 'surface').length;
  console.log(`\n${C.bold}${s.label}${C.reset}  ${C.dim}${worth} worth a look of ${list.length} ranked${C.reset}`);

  for (const d of list.slice(0, TOP)) {
    const c = color(d);
    const price = d.price == null ? '—' : `$${d.price}`;
    // A negative discount is the listing being *over* fair value. Printing
    // "-50% under" reads as a typo and makes an overpriced item look underpriced.
    const gap = d.discount_pct == null ? d.reason
      : d.discount_pct < 0 ? `${Math.abs(d.discount_pct)}% OVER $${d.fair_value}`
      : `${d.discount_pct}% under $${d.fair_value}`;
    const flags = d.flags?.length ? `  [${d.flags.map((f) => f.text).join('; ')}]` : '';
    const score = d.score == null ? ' —' : String(d.score).padStart(3);

    console.log(`  ${C.dim}#${String(d.rank_in_search).padEnd(3)}${C.reset}${c}${score} · ${price} · ${gap}${C.reset}${C.red}${flags}${C.reset}`);
    console.log(`       ${d.title ?? '(no title)'}`);
    const km = d.assessment?.distance_km;
    const meta = [d.location, km != null ? `~${km} km` : null, d.verdict].filter(Boolean).join(' · ');
    if (meta) console.log(`       ${C.dim}${meta}${C.reset}`);
    if (d.fair_value_basis) console.log(`       ${C.dim}${d.fair_value_basis} (confidence: ${d.fair_value_confidence})${C.reset}`);
    if (d.url) console.log(`       ${C.dim}${d.url}${C.reset}`);
  }
  if (list.length > TOP) console.log(`  ${C.dim}… ${list.length - TOP} more — use --all${C.reset}`);
}

const worth = scored.filter((d) => d.status === 'surface').length;
console.log(`\n${C.dim}${worth} worth a look of ${scored.length} ranked${C.reset}`);
