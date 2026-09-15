#!/usr/bin/env node
// Pushes the local store up to the hosted dashboard so your phone can see it.
//
//   node scripts/push.mjs
//
// Runs at the end of a hunt. Local JSON files stay the working copy — this is
// a one-way sync up, except for verdicts, which are pulled down first because
// the hosted dashboard is where you'll actually be tapping Save and Dismiss.
//
// Auth is a personal push token against the dashboard's API, so the Supabase
// service role key never has to exist on this machine. .env.local needs:
//
//   DEALFINDER_API_URL=https://<your-instance>.vercel.app
//   DEALFINDER_PUSH_TOKEN=dfp_...   (shown once at signup; regen from Account)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadListings, loadSearches, loadRuns, loadVerdicts, saveVerdicts, ROOT } from './lib/store.mjs';

loadDotEnv();

const API_URL = (process.env.DEALFINDER_API_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.DEALFINDER_PUSH_TOKEN;

if (!API_URL || !TOKEN) {
  console.error(
    'Missing DEALFINDER_API_URL or DEALFINDER_PUSH_TOKEN in .env.local.\n' +
    'Sign up (or regenerate a token from the Account tab) on the hosted\n' +
    'dashboard, then put both values in .env.local. See GETTING-STARTED.md.'
  );
  process.exit(1);
}

const listings = loadListings().listings ?? {};
const searches = loadSearches();
const runs = loadRuns().runs ?? [];

const ids = Object.keys(listings);
if (!ids.length) {
  console.error('nothing to push — the local store is empty');
  process.exit(1);
}

// Pull remote verdicts down first. If you dismissed something on your phone,
// that decision is newer than anything local and must not be overwritten by
// the push that follows.
const { verdicts: remoteVerdicts = [] } = await api('GET', '/api/pull-verdicts');
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
// thousand is not, and this store only grows. The final chunk carries the
// verdicts, config, and last run.
const rows = ids.map((id) => {
  const { first_seen, last_seen, search_id, ...payload } = listings[id];
  return { id, search_id, payload, first_seen, last_seen };
});
const verdictRows = Object.entries(localVerdicts).map(([listing_id, v]) => ({
  listing_id, state: v.state, updated_at: v.at,
}));
const lastRun = runs.at(-1) ?? null;

const batches = [...chunks(rows, 200)];
for (let i = 0; i < batches.length; i++) {
  const final = i === batches.length - 1;
  await api('POST', '/api/push', {
    listings: batches[i],
    ...(final ? { verdicts: verdictRows, searches, last_run: lastRun } : {}),
  });
}

console.log(`pushed ${rows.length} listings, ${verdictRows.length} verdicts, searches config, last run`);
if (pulled) console.log(`pulled ${pulled} newer verdict(s) down from the dashboard first`);

async function api(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; }
  catch {
    throw new Error(
      `${method} ${path} → ${res.status}: non-JSON response. If this is a\n` +
      'Vercel login page, the deployment still has Deployment Protection on —\n' +
      'turn it off in Vercel → Settings → Deployment Protection.'
    );
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${parsed.error ?? text.slice(0, 200)}`);
  return parsed;
}

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
