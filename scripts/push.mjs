#!/usr/bin/env node
// Pushes the local store up to Supabase so the hosted dashboard can see it.
//
//   node scripts/push.mjs
//
// Runs at the end of a hunt. Local JSON files stay the working copy — this is a
// one-way sync up, except for verdicts, which are pulled down first because the
// hosted dashboard is where you'll actually be tapping Save and Dismiss.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadListings, loadSearches, loadRuns, loadVerdicts, saveVerdicts, ROOT } from './lib/store.mjs';
import { upsert, select } from './lib/supabase.mjs';

loadDotEnv();

const listings = loadListings().listings ?? {};
const searches = loadSearches();
const runs = loadRuns().runs ?? [];

const ids = Object.keys(listings);
if (!ids.length) {
  console.error('nothing to push — the local store is empty');
  process.exit(1);
}

// Pull remote verdicts down first. If you dismissed something on your phone,
// that decision is newer than anything local and must not be overwritten by the
// push that follows.
const remoteVerdicts = (await select('verdicts', 'select=listing_id,state,updated_at')) ?? [];
const localVerdicts = loadVerdicts();
let pulled = 0;
for (const row of remoteVerdicts) {
  const local = localVerdicts[row.listing_id];
  if (!local || new Date(row.updated_at) > new Date(local.at)) {
    localVerdicts[row.listing_id] = { state: row.state, at: row.updated_at };
    pulled++;
  }
}
if (pulled) saveVerdicts(localVerdicts);

// Chunked because a few hundred listings in one request is fine but a few
// thousand is not, and this store only grows.
const rows = ids.map((id) => {
  const { first_seen, last_seen, search_id, ...payload } = listings[id];
  return { id, search_id, payload, first_seen, last_seen };
});
for (const chunk of chunks(rows, 200)) await upsert('listings', chunk);

const verdictRows = Object.entries(localVerdicts).map(([listing_id, v]) => ({
  listing_id, state: v.state, updated_at: v.at,
}));
if (verdictRows.length) await upsert('verdicts', verdictRows);

if (searches) await upsert('config', { key: 'searches', payload: searches, updated_at: new Date().toISOString() });

const lastRun = runs.at(-1);
if (lastRun) {
  await upsert('runs', { started: lastRun.started, finished: lastRun.finished ?? null, payload: lastRun });
}

console.log(`pushed ${rows.length} listings, ${verdictRows.length} verdicts, searches config, last run`);
if (pulled) console.log(`pulled ${pulled} newer verdict(s) down from the dashboard first`);

function* chunks(arr, size) {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

// Minimal .env.local reader — avoids a dotenv dependency for four lines of work.
function loadDotEnv() {
  const path = join(ROOT, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}
