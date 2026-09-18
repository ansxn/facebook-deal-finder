import { loadRunState, pickRun } from './_lib/runs.mjs';
import { getUser } from './_lib/auth.mjs';

// Deliberately not wrapped in guard(): the dashboard calls this first to find
// out whether it needs to show a login screen, so an unauthenticated request
// has to get a useful answer rather than a bare 401.
//
// Reads run state only. It used to go through loadAll(), which also pulled
// every listing the account had ever seen — on every dashboard load, to show a
// timestamp.
export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  let user;
  try {
    user = await getUser(req);
  } catch (err) {
    res.status(500).json({ error: err.message });
    return;
  }
  if (!user) {
    res.status(401).json({ auth_required: true, authed: false });
    return;
  }

  try {
    const state = await loadRunState(user.id);
    res.status(200).json({
      authed: true,
      auth_required: true,
      email: user.email,
      last_run: state.lastRun,
      runs: state.runs.map(pickRun),
      hours_since: state.hoursSince,
      min_hours: state.minHours,
      can_run: state.canRun,
      hosted: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
