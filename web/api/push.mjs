// The sync target for `scripts/push.mjs`. Bearer push-token auth, because
// this is a machine calling, not a browser — and because friends of a hosted
// instance must never hold the Supabase service role key. This endpoint is
// the only way listings enter the database from outside.
//
// The client chunks listings (200 per request) and repeats calls; verdicts,
// searches and last_run ride along on whichever call has them. user_id is
// stamped server-side on every row — nothing the client sends can write into
// another user's data.

import { upsert, select } from './_lib/supabase.mjs';
import { guardToken } from './_lib/auth.mjs';

const MAX_BODY_BYTES = 3 * 1024 * 1024;
const MAX_LISTINGS_PER_REQUEST = 200;
const MAX_LISTINGS_PER_USER = Number(process.env.MAX_LISTINGS_PER_USER ?? 20000);

export default guardToken(async (req, res, user) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const body = req.body ?? {};
  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'body too large — send listings in chunks of 200' });
    return;
  }

  const listings = Array.isArray(body.listings) ? body.listings : [];
  const verdicts = Array.isArray(body.verdicts) ? body.verdicts : [];

  if (listings.length > MAX_LISTINGS_PER_REQUEST) {
    res.status(413).json({ error: `at most ${MAX_LISTINGS_PER_REQUEST} listings per request` });
    return;
  }

  try {
    if (listings.length) {
      // The cap is a safety valve against a runaway or hostile client filling
      // the shared database, not a quota anyone should meet honestly.
      const existing = (await select(
        'listings', `select=id&user_id=eq.${encodeURIComponent(user.id)}&limit=${MAX_LISTINGS_PER_USER}`
      )) ?? [];
      if (existing.length + listings.length > MAX_LISTINGS_PER_USER) {
        res.status(403).json({ error: `over the ${MAX_LISTINGS_PER_USER}-listing cap for this account` });
        return;
      }

      await upsert('listings', listings.map((row) => ({
        user_id: user.id,
        id: String(row.id),
        search_id: row.search_id ?? null,
        payload: row.payload ?? {},
        first_seen: row.first_seen ?? null,
        last_seen: row.last_seen ?? null,
      })));
    }

    if (verdicts.length) {
      await upsert('verdicts', verdicts.map((row) => ({
        user_id: user.id,
        listing_id: String(row.listing_id),
        state: row.state,
        updated_at: row.updated_at,
      })));
    }

    if (body.searches) {
      await upsert('config', {
        user_id: user.id, key: 'searches', payload: body.searches,
        updated_at: new Date().toISOString(),
      });
    }

    if (body.last_run?.started) {
      await upsert('runs', {
        user_id: user.id,
        started: body.last_run.started,
        finished: body.last_run.finished ?? null,
        payload: body.last_run,
      });
    }

    res.status(200).json({
      ok: true,
      listings: listings.length,
      verdicts: verdicts.length,
      searches: Boolean(body.searches),
      last_run: Boolean(body.last_run?.started),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
