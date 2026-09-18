// Where a hunt sends what it found. Bearer push-token auth, because this is a
// machine calling — and because friends of a hosted instance must never hold
// the Supabase service role key. This is the only way listings enter the
// database from outside.
//
// It answers with the ranking for that search, so the hunt can say what it
// found without a second call. user_id is stamped server-side on every row;
// nothing the caller sends can write into another account's data.

import { selectForUser, countForUser } from './_lib/supabase.mjs';
import { ingestBatch } from './_lib/listings.mjs';
import { scoreAll, compactDeal } from './_lib/score.mjs';
import { guardToken } from './_lib/auth.mjs';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_LISTINGS_PER_REQUEST = 100;
const MAX_LISTINGS_PER_USER = Number(process.env.MAX_LISTINGS_PER_USER ?? 20000);
const DEFAULT_TOP = 10;
const MAX_TOP = 50;

export default guardToken(async (req, res, user) => {
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const body = req.body ?? {};
  const listings = Array.isArray(body.listings) ? body.listings : null;
  if (!listings) {
    res.status(400).json({ error: 'send { "search_id": "...", "listings": [ ... ] }' });
    return;
  }
  if (listings.length > MAX_LISTINGS_PER_REQUEST) {
    res.status(413).json({
      error: `at most ${MAX_LISTINGS_PER_REQUEST} listings per request — send one search at a time`,
    });
    return;
  }
  // Measured after parsing, so it is a backstop rather than a true limit; the
  // platform's own body ceiling is the real one.
  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'body too large — send fewer listings per request' });
    return;
  }

  try {
    const configRows = await selectForUser('config', user.id, 'select=payload&key=eq.searches');
    const searches = configRows?.[0]?.payload ?? null;
    if (!searches?.searches?.length) {
      res.status(400).json({ error: 'no searches configured yet — run setup first' });
      return;
    }

    const known = searches.searches.map((s) => s.id);
    const searchId = body.search_id ?? null;
    // Every listing has to belong to a search that exists, or it lands in the
    // store scoring against nothing and is invisible on the dashboard.
    const wanted = new Set(listings.map((l) => l?.search_id ?? searchId));
    if (wanted.has(null) || wanted.has(undefined)) {
      res.status(400).json({ error: 'every listing needs a search_id, or send search_id once for the batch', known });
      return;
    }
    const unknown = [...wanted].filter((id) => !known.includes(id));
    if (unknown.length) {
      res.status(400).json({ error: `unknown search_id: ${unknown.join(', ')}`, known });
      return;
    }

    if (listings.length) {
      const held = await countForUser('listings', user.id);
      if (held + listings.length > MAX_LISTINGS_PER_USER) {
        res.status(403).json({ error: `over the ${MAX_LISTINGS_PER_USER}-listing cap for this account` });
        return;
      }
    }

    const counts = await ingestBatch({ userId: user.id, searchId, listings });

    // Rank has to be computed over the whole search, not just this batch, or
    // "number 1" means "best of the last thirty" rather than best you've seen.
    const forSearch = searchId ?? [...wanted][0];
    const [listingRows, verdictRows] = await Promise.all([
      selectForUser(
        'listings',
        user.id,
        `select=id,search_id,payload,first_seen,last_seen&search_id=eq.${encodeURIComponent(forSearch)}`
      ),
      selectForUser('verdicts', user.id, 'select=listing_id,state,updated_at'),
    ]);

    const store = { version: 1, listings: {} };
    for (const row of listingRows ?? []) {
      store.listings[row.id] = {
        ...row.payload,
        id: row.id,
        search_id: row.search_id,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
      };
    }
    const verdicts = {};
    for (const row of verdictRows ?? []) verdicts[row.listing_id] = { state: row.state, at: row.updated_at };

    const scored = scoreAll({ listings: store, searches, verdicts });
    const top = Math.min(Number(req.query?.top) || DEFAULT_TOP, MAX_TOP);

    res.status(200).json({
      ok: true,
      search_id: forSearch,
      counts: {
        received: counts.received,
        new: counts.new,
        updated: counts.updated,
        repriced: counts.repriced.length,
        skipped: counts.skipped.length,
      },
      repriced: counts.repriced,
      skipped: counts.skipped,
      totals: {
        surface: scored.filter((d) => d.status === 'surface').length,
        ranked: scored.filter((d) => d.status === 'ranked').length,
        pending: scored.filter((d) => d.status === 'pending').length,
        total: scored.length,
      },
      top: scored.slice(0, top).map(compactDeal),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
