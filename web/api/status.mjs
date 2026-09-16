import { loadAll } from './_lib/supabase.mjs';
import { getUser } from './_lib/auth.mjs';

// Deliberately not wrapped in guard(): the dashboard calls this first to find
// out whether it needs to show a login screen, so an unauthenticated request
// has to get a useful answer rather than a bare 401.
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
    const { lastRun, runs, searches } = await loadAll(user.id);
    const pick = (r) => r && ({ started: r.started, finished: r.finished ?? null, status: r.status ?? null, listings_seen: r.listings_seen ?? 0, new_listings: r.new_listings ?? 0, searches: r.searches ?? [] });
    const minHours = searches?.global?.pacing?.min_hours_between_runs ?? 18;
    const hoursSince = lastRun?.started
      ? (Date.now() - new Date(lastRun.started).getTime()) / 36e5
      : null;

    res.status(200).json({
      authed: true,
      auth_required: true,
      email: user.email,
      last_run: lastRun,
      runs: (runs ?? []).map(pick),
      hours_since: hoursSince,
      min_hours: minHours,
      can_run: hoursSince == null || hoursSince >= minHours,
      hosted: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
