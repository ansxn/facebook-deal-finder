// Supabase access over plain PostgREST + fetch.
//
// No @supabase/supabase-js on purpose: the whole tool has zero dependencies, and
// everything needed here is four HTTP verbs against a REST endpoint. Keeping it
// dependency-free also means the Vercel functions have no install step.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service role key
// bypasses RLS, so it must never reach a browser — it is read from the
// environment on the server only.

export function supabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Locally: put them in .env.local (gitignored).\n' +
      'On Vercel: Project Settings → Environment Variables.'
    );
  }
  return { url: url.replace(/\/$/, ''), key };
}

async function request(path, { method = 'GET', body, prefer, env } = {}) {
  const { url, key } = supabaseConfig(env);
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  };
  if (prefer) headers.prefer = prefer;

  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${detail.slice(0, 400)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const select = (table, query = '', env) =>
  request(`${table}${query ? `?${query}` : ''}`, { env });

/** Insert-or-update on the primary key. */
export const upsert = (table, rows, env) =>
  request(table, {
    method: 'POST',
    body: Array.isArray(rows) ? rows : [rows],
    prefer: 'resolution=merge-duplicates,return=minimal',
    env,
  });

export const remove = (table, query, env) =>
  request(`${table}?${query}`, { method: 'DELETE', prefer: 'return=minimal', env });

/**
 * Everything the dashboard needs, in three round trips instead of one per
 * listing. Serverless functions are billed on wall-clock time, so the shape of
 * this matters more than it would locally.
 */
export async function loadAll(env) {
  const [listingRows, verdictRows, configRows, runRows] = await Promise.all([
    select('listings', 'select=id,search_id,payload,first_seen,last_seen', env),
    select('verdicts', 'select=listing_id,state,updated_at', env),
    select('config', 'select=payload&key=eq.searches', env),
    select('runs', 'select=payload&order=started.desc&limit=1', env),
  ]);

  const listings = { version: 1, listings: {} };
  for (const row of listingRows ?? []) {
    listings.listings[row.id] = {
      ...row.payload,
      id: row.id,
      search_id: row.search_id,
      first_seen: row.first_seen,
      last_seen: row.last_seen,
    };
  }

  const verdicts = {};
  for (const row of verdictRows ?? []) {
    verdicts[row.listing_id] = { state: row.state, at: row.updated_at };
  }

  return {
    listings,
    verdicts,
    searches: configRows?.[0]?.payload ?? null,
    lastRun: runRows?.[0]?.payload ?? null,
  };
}
