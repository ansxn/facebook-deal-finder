// Run state: when the last hunt happened, and whether another one is allowed.
//
// This was a local script whose exit code was the answer. Over HTTP the answer
// is a status code instead, and the gate lives inside `start` rather than in a
// separate `check` — "once a day" has to be mechanical, and a can_run:false
// body is something an eager agent can read past on its way to browsing.

import { select, update, upsert, selectForUser } from './supabase.mjs';

export const DEFAULT_MIN_HOURS = 18;

// A run that never called finish or abort — a crash, a closed laptop, a session
// that wandered off — otherwise stays "running" forever, which makes status lie
// and blocks every later run. Nothing legitimate takes hours.
export const STALE_RUN_HOURS = 2;

export const hoursSince = (iso) =>
  iso ? (Date.now() - new Date(iso).getTime()) / 36e5 : null;

const RUN_FIELDS = 'select=started,finished,payload&order=started.desc&limit=30';

/**
 * Everything the gate needs, in two queries: the recent runs and the pacing
 * setting that lives in the searches config. Deliberately not loadAll(), which
 * also pulls every listing the user has ever seen.
 */
export async function loadRunState(userId) {
  const [runRows, configRows] = await Promise.all([
    selectForUser('runs', userId, RUN_FIELDS),
    selectForUser('config', userId, 'select=payload&key=eq.searches'),
  ]);

  const searches = configRows?.[0]?.payload ?? null;
  const minHours = searches?.global?.pacing?.min_hours_between_runs ?? DEFAULT_MIN_HOURS;

  let runs = (runRows ?? []).map((r) => ({ ...(r.payload ?? {}), started: r.started, finished: r.finished }));

  const stale = runs.filter(
    (r) => r.status === 'running' && (hoursSince(r.started) ?? 0) > STALE_RUN_HOURS
  );
  for (const run of stale) {
    const finished = new Date().toISOString();
    const payload = {
      ...run,
      status: 'abandoned',
      finished,
      abort_reason: `no finish or abort recorded within ${STALE_RUN_HOURS}h`,
    };
    await update(
      'runs',
      `user_id=eq.${encodeURIComponent(userId)}&started=eq.${encodeURIComponent(run.started)}`,
      { finished, payload }
    );
    run.status = 'abandoned';
    run.finished = finished;
    run.abort_reason = payload.abort_reason;
  }

  const lastRun = runs[0] ?? null;
  const since = hoursSince(lastRun?.started);
  const open = runs.find((r) => r.status === 'running') ?? null;

  return {
    runs,
    lastRun,
    open,
    searches,
    minHours,
    hoursSince: since,
    canRun: since == null || since >= minHours,
    reaped: stale.length,
  };
}

/** Trimmed shape for the dashboard's activity list and the morning digest. */
export const pickRun = (r) =>
  r && {
    started: r.started,
    finished: r.finished ?? null,
    status: r.status ?? null,
    listings_seen: r.listings_seen ?? 0,
    new_listings: r.new_listings ?? 0,
    searches: r.searches ?? [],
    ...(r.abort_reason ? { abort_reason: r.abort_reason } : {}),
    ...(r.forced ? { forced: true } : {}),
  };

export async function startRun(userId, { forced = false } = {}) {
  const started = new Date().toISOString();
  const payload = {
    started,
    forced,
    searches: [],
    listings_seen: 0,
    new_listings: 0,
    status: 'running',
  };
  await upsert('runs', { user_id: userId, started, finished: null, payload });
  return payload;
}

/**
 * Close the open run. `started` comes from the row we just read, never from the
 * caller — a client-supplied run key is a way to write into someone else's row.
 */
export async function closeRun(userId, open, fields) {
  const finished = new Date().toISOString();
  const payload = { ...open, ...fields, finished };
  await update(
    'runs',
    `user_id=eq.${encodeURIComponent(userId)}&started=eq.${encodeURIComponent(open.started)}`,
    { finished, payload }
  );
  return payload;
}

// --- field notes -------------------------------------------------------
//
// The hunt learns things about Facebook's markup that are worth remembering but
// not worth a release: a results page that stalls at 15 cards this week, a popup
// that needs a click. It used to write those into its own skill file, which a
// plugin cannot do. They live in the config instead, and get written here —
// inside the finish call — so a slider edit made on a phone mid-hunt can't be
// clobbered by the skill reading, editing and saving the whole config itself.

const MAX_FIELD_NOTES = 20;
const MAX_NOTE_CHARS = 300;

export async function appendFieldNotes(userId, searches, notes) {
  const clean = (Array.isArray(notes) ? notes : [])
    .filter((n) => typeof n === 'string' && n.trim())
    .map((n) => n.trim().slice(0, MAX_NOTE_CHARS));
  if (!clean.length || !searches) return null;

  const config = { ...searches };
  config.global = { ...(config.global ?? {}) };
  const existing = Array.isArray(config.global.field_notes) ? config.global.field_notes : [];
  config.global.field_notes = [...existing, ...clean].slice(-MAX_FIELD_NOTES);

  const updated_at = new Date().toISOString();
  config.updated_at = updated_at;
  await upsert('config', { user_id: userId, key: 'searches', payload: config, updated_at });
  return config.global.field_notes;
}

export { select };
