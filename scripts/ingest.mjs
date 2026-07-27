#!/usr/bin/env node
// Folds a batch of browsed listings into the local store.
//
//   node scripts/ingest.mjs data/incoming/golf-2026-07-27.json
//   cat listings.json | node scripts/ingest.mjs -
//
// Input is a JSON array, or an object with a `listings` array. Each entry needs
// at minimum an `id` and `url`; everything else is optional and merged on later
// passes.

import { readFileSync } from 'node:fs';
import { ingest, loadSearches } from './lib/store.mjs';

const [source, ...args] = process.argv.slice(2);
if (!source) {
  console.error('usage: ingest.mjs <file.json | -> [--search <id>]');
  process.exit(2);
}

const text = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
let parsed;
try {
  parsed = JSON.parse(text);
} catch (err) {
  console.error(`input is not valid JSON: ${err.message}`);
  process.exit(1);
}

const batch = Array.isArray(parsed) ? parsed : parsed.listings;
if (!Array.isArray(batch)) {
  console.error('expected a JSON array of listings, or { "listings": [...] }');
  process.exit(1);
}

const searchFlag = args[args.indexOf('--search') + 1];
const searchId = args.includes('--search') ? searchFlag : parsed.search_id;

const known = new Set((loadSearches()?.searches ?? []).map((s) => s.id));
const unknown = new Set(
  batch.map((l) => l.search_id ?? searchId).filter((id) => id && !known.has(id))
);
if (unknown.size) {
  console.error(`unknown search id(s): ${[...unknown].join(', ')}`);
  console.error(`known: ${[...known].join(', ')}`);
  process.exit(1);
}
if (!searchId && batch.some((l) => !l.search_id)) {
  console.error('some listings have no search_id — pass --search <id>');
  process.exit(1);
}

const result = ingest(batch, { searchId });

console.log(`ingested ${batch.length} listing(s)`);
console.log(`  new:      ${result.new.length}`);
console.log(`  updated:  ${result.updated.length}`);
if (result.repriced.length) {
  console.log(`  repriced: ${result.repriced.length}`);
  for (const r of result.repriced) {
    const dir = r.to < r.from ? '↓' : '↑';
    console.log(`      ${dir} ${r.id}: $${r.from} → $${r.to}`);
  }
}
if (result.skipped.length) {
  console.log(`  skipped:  ${result.skipped.length}`);
  for (const s of result.skipped) console.log(`      ${s.reason}: ${s.title ?? '(untitled)'}`);
}
