#!/usr/bin/env node
// Run-state gate. The browse skill calls this before touching Facebook, and the
// exit code is the answer: 0 = clear to run, 1 = too soon.
//
// This exists as a script rather than as judgment inside the skill on purpose.
// "Once a day" has to be a mechanical check, not something that can be talked
// out of by an eager agent mid-conversation.

import { loadRuns, saveRuns, loadSearches } from './lib/store.mjs';

const [cmd, ...args] = process.argv.slice(2);
const now = () => new Date().toISOString();

const runs = loadRuns();
const minHours = loadSearches()?.global?.pacing?.min_hours_between_runs ?? 18;

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

// A run that never called finish or abort — a crash, a closed terminal, a
// session that wandered off — otherwise stays "running" forever, which makes
// `status` lie and lets `finish` close the wrong record. Nothing legitimate
// takes hours, so anything older than this was abandoned.
const STALE_RUN_HOURS = 2;
let reaped = 0;
for (const run of runs.runs) {
  if (run.status === 'running' && hoursSince(run.started) > STALE_RUN_HOURS) {
    run.status = 'abandoned';
    run.finished = new Date().toISOString();
    run.abort_reason = `no finish or abort recorded within ${STALE_RUN_HOURS}h`;
    reaped++;
  }
}
if (reaped) {
  saveRuns(runs);
  console.error(`(closed ${reaped} abandoned run${reaped > 1 ? 's' : ''})`);
}

const last = runs.runs.at(-1);

switch (cmd) {
  case 'check': {
    const since = hoursSince(last?.started);
    if (since >= minHours) {
      console.log(`OK — clear to run (${last ? `${since.toFixed(1)}h since last run` : 'no previous run'})`);
      process.exit(0);
    }
    const wait = (minHours - since).toFixed(1);
    console.log(
      `TOO SOON — last run was ${since.toFixed(1)}h ago, minimum is ${minHours}h.\n` +
      `Wait ${wait}h, or override deliberately with: node scripts/run.mjs start --force`
    );
    process.exit(1);
  }

  case 'start': {
    const force = args.includes('--force');
    const since = hoursSince(last?.started);
    if (!force && since < minHours) {
      console.error(`refusing to start — ${since.toFixed(1)}h since last run, minimum ${minHours}h`);
      process.exit(1);
    }
    runs.runs.push({ started: now(), forced: force, searches: [], listings_seen: 0, new_listings: 0, status: 'running' });
    saveRuns(runs);
    console.log(`run started${force ? ' (forced)' : ''}`);
    break;
  }

  case 'finish': {
    if (!last || last.status !== 'running') { console.error('no run in progress'); process.exit(1); }
    Object.assign(last, {
      finished: now(),
      status: 'complete',
      listings_seen: Number(flag(args, '--seen') ?? last.listings_seen),
      new_listings: Number(flag(args, '--new') ?? last.new_listings),
      searches: (flag(args, '--searches') ?? '').split(',').filter(Boolean),
    });
    saveRuns(runs);
    console.log(`run complete — ${last.listings_seen} seen, ${last.new_listings} new`);
    break;
  }

  // Called when Facebook shows a checkpoint, CAPTCHA, or anything unexpected.
  // Recorded rather than swallowed, so a pattern of aborts is visible.
  case 'abort': {
    if (!last || last.status !== 'running') { console.error('no run in progress'); process.exit(1); }
    Object.assign(last, { finished: now(), status: 'aborted', abort_reason: args.join(' ') || 'unspecified' });
    saveRuns(runs);
    console.log(`run aborted — ${last.abort_reason}`);
    break;
  }

  case 'status': {
    if (!last) { console.log('no runs recorded yet'); break; }
    console.log(JSON.stringify(last, null, 2));
    console.log(`\n${hoursSince(last.started).toFixed(1)}h since last run started (minimum gap ${minHours}h)`);
    break;
  }

  default:
    console.log('usage: run.mjs check | start [--force] | finish [--seen N --new N --searches a,b] | abort <reason> | status');
    process.exit(2);
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}
