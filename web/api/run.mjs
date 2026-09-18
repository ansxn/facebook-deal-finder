// The run gate. A hunt opens with `start` and closes with `finish` or `abort`.
//
// There is no separate `check` action on purpose. When the gate was a local
// script, its exit code was the answer and there was nothing to argue with.
// Over HTTP the equivalent is a refusal: `start` returns 409 when it is too
// soon, so the check cannot be read past on the way to browsing.

import { guardToken } from './_lib/auth.mjs';
import {
  loadRunState,
  startRun,
  closeRun,
  appendFieldNotes,
  pickRun,
  STALE_RUN_HOURS,
} from './_lib/runs.mjs';

const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

export default guardToken(async (req, res, user) => {
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only — send { "action": "status" }' });
    return;
  }

  const action = req.body?.action ?? 'status';

  try {
    const state = await loadRunState(user.id);
    const base = {
      hours_since: round1(state.hoursSince),
      min_hours: state.minHours,
    };

    if (action === 'status') {
      res.status(200).json({
        ...base,
        can_run: state.canRun,
        last_run: pickRun(state.lastRun),
        runs: state.runs.map(pickRun),
        in_progress: pickRun(state.open),
        reaped: state.reaped,
      });
      return;
    }

    if (action === 'start') {
      if (state.open) {
        res.status(409).json({
          ...base,
          error: 'a run is already in progress',
          in_progress: pickRun(state.open),
          hint: `it closes itself ${STALE_RUN_HOURS}h after it started if it never finished`,
        });
        return;
      }
      const forced = req.body?.force === true;
      if (!state.canRun && !forced) {
        const wait = round1(state.minHours - state.hoursSince);
        res.status(409).json({
          ...base,
          error: `too soon — last run was ${round1(state.hoursSince)}h ago, minimum gap is ${state.minHours}h`,
          can_run: false,
          wait_hours: wait,
          last_run: pickRun(state.lastRun),
        });
        return;
      }
      const run = await startRun(user.id, { forced });
      res.status(200).json({ ...base, ok: true, run: pickRun(run) });
      return;
    }

    if (action === 'finish' || action === 'abort') {
      if (!state.open) {
        res.status(409).json({ ...base, error: 'no run in progress', last_run: pickRun(state.lastRun) });
        return;
      }

      const fields =
        action === 'finish'
          ? {
              status: 'complete',
              listings_seen: Number(req.body?.seen ?? state.open.listings_seen ?? 0),
              new_listings: Number(req.body?.new ?? state.open.new_listings ?? 0),
              searches: Array.isArray(req.body?.searches) ? req.body.searches : state.open.searches ?? [],
            }
          : {
              status: 'aborted',
              abort_reason: String(req.body?.reason ?? '').trim() || 'unspecified',
            };

      const run = await closeRun(user.id, state.open, fields);
      const notes = await appendFieldNotes(user.id, state.searches, req.body?.field_notes);

      res.status(200).json({ ...base, ok: true, run: pickRun(run), field_notes: notes });
      return;
    }

    res.status(400).json({ error: 'action must be start, finish, abort or status' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
