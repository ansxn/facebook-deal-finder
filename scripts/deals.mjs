#!/usr/bin/env node
// Ranked deals in the terminal — the same scoring the dashboard uses, minus the
// dashboard. Useful for checking scoring changes without a browser.
//
//   node scripts/deals.mjs                 surfaced deals only
//   node scripts/deals.mjs --all           everything, including rejects
//   node scripts/deals.mjs --search golf-complete-sets
//   node scripts/deals.mjs --json

import { loadListings, loadSearches, loadVerdicts } from './lib/store.mjs';
import { scoreAll } from './lib/score.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => args[args.indexOf(f) + 1];

const searches = loadSearches();
if (!searches) { console.error('searches.json not found'); process.exit(1); }

let scored = scoreAll({
  listings: loadListings(),
  searches,
  verdicts: loadVerdicts(),
  includeDismissed: has('--all'),
});

if (has('--search')) scored = scored.filter((d) => d.search_id === val('--search'));
if (!has('--all')) scored = scored.filter((d) => d.status === 'surface');

if (has('--json')) {
  console.log(JSON.stringify(scored, null, 2));
  process.exit(0);
}

if (!scored.length) {
  console.log(has('--all') ? 'No listings stored yet — run a browse first.' : 'Nothing above your threshold right now.');
  process.exit(0);
}

const C = { dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m' };
const color = (d) =>
  d.status !== 'surface' ? C.dim
  : d.label === 'steal' ? C.green
  : d.label === 'good deal' ? C.yellow
  : '';

let currentSearch = null;
for (const d of scored) {
  if (d.search_id !== currentSearch) {
    currentSearch = d.search_id;
    const label = searches.searches.find((s) => s.id === currentSearch)?.label ?? currentSearch;
    console.log(`\n${C.bold}${label}${C.reset}`);
  }

  const c = color(d);
  const price = d.price == null ? '—' : `$${d.price}`;
  // A negative discount is the listing being *over* fair value. Printing
  // "-50% under" reads as a typo and makes an overpriced item look underpriced.
  const gap = d.discount_pct < 0
    ? `${Math.abs(d.discount_pct)}% OVER $${d.fair_value}`
    : `${d.discount_pct}% under $${d.fair_value}`;

  const headline =
    d.status === 'surface' ? `${d.score} · ${price} · ${gap}`
    : d.status === 'below_threshold' ? `${price} · ${gap} — below threshold`
    : d.status === 'disqualified' ? `${price} · rejected: ${d.reason}`
    : `${price} · ${d.reason}`;

  console.log(`  ${c}${headline}${C.reset}`);
  console.log(`    ${d.title ?? '(no title)'}`);
  const meta = [d.location, d.miles != null ? `${d.miles}mi` : null, d.verdict].filter(Boolean).join(' · ');
  if (meta) console.log(`    ${C.dim}${meta}${C.reset}`);
  if (d.status === 'surface') {
    console.log(`    ${C.dim}${d.fair_value_basis} (confidence: ${d.fair_value_confidence})${C.reset}`);
  }
  if (d.url) console.log(`    ${C.dim}${d.url}${C.reset}`);
  console.log();
}

const surfaced = scored.filter((d) => d.status === 'surface').length;
console.log(`${C.dim}${surfaced} surfaced of ${scored.length} shown${C.reset}`);
