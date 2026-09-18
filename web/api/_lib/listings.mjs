// Ingest: the one place browsed listings enter the database.
//
// This used to live on the laptop (scripts/lib/store.mjs) against a JSON file.
// It moved here so a hunt needs nothing installed but a browser — and because
// two copies of merge logic is how price history quietly goes wrong.
//
// Dedupe is by Marketplace listing id, which survives edits to the title and
// price. Re-seeing a listing is not an error: it bumps last_seen and appends to
// price history if the seller moved the price, which is a genuine buying signal.

import { upsert, selectForUser } from './supabase.mjs';

/** Accepts 350, "350", "$350", "$1,350", "Free". Returns a number or null. */
export function normalizePrice(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  if (/free/i.test(input)) return 0;
  const digits = input.replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? n : null;
}

// Marketplace ids are numeric, but the test fixtures use names like
// "fixture-001". Anything outside this set is rejected before it reaches the
// query string, which is also what keeps it out of the `id=in.(...)` list.
const ID_OK = /^[A-Za-z0-9_-]{3,40}$/;

// Fields the merge loop must not touch: they are either database columns or
// they need real merge rules, both handled explicitly below. `price` is in here
// because letting a raw "CA$300" through wrote a string over the parsed number
// and every score downstream came out NaN.
const HANDLED = new Set([
  'id', 'search_id', 'first_seen', 'last_seen',
  'price', 'price_history', 'assessment',
]);

/**
 * A later pass usually knows more than an earlier one — a detail page beats a
 * result card — but not always: a second pass that only re-read the card would
 * otherwise wipe the must-haves and the clean title the first pass worked out.
 * So merge per field, and per spec inside the rule maps.
 */
function mergeAssessment(old = {}, next = {}) {
  const out = { ...old };
  for (const [k, v] of Object.entries(next)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if ((k === 'must_have' || k === 'nice_to_have') && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = { ...(old[k] ?? {}), ...v };
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Fold one browsed listing into its stored row.
 *
 * Pure: takes the existing row (or null) and returns the row to write. The
 * caller does the I/O, which is what makes the merge rules testable without a
 * database.
 */
export function mergeListing(existingRow, raw, now, fallbackSearchId) {
  const id = String(raw.id ?? '').trim();
  const price = normalizePrice(raw.price);

  if (!existingRow) {
    const payload = {};
    for (const [k, v] of Object.entries(raw)) {
      if (HANDLED.has(k)) continue;
      payload[k] = v;
    }
    if (raw.assessment && typeof raw.assessment === 'object') payload.assessment = raw.assessment;
    payload.price = price;
    payload.price_history = price == null ? [] : [{ at: now, price }];
    return {
      outcome: 'new',
      repriced: null,
      row: {
        id,
        search_id: raw.search_id ?? fallbackSearchId ?? null,
        first_seen: now,
        last_seen: now,
        payload,
      },
    };
  }

  const payload = { ...(existingRow.payload ?? {}) };
  let repriced = null;

  const lastPrice = payload.price_history?.at(-1)?.price;
  if (price != null && price !== lastPrice) {
    payload.price_history = [...(payload.price_history ?? []), { at: now, price }];
    payload.price = price;
    if (lastPrice != null) repriced = { id, from: lastPrice, to: price };
  } else if (price != null && payload.price == null) {
    // A row stored before the price could be read. Not a price change.
    payload.price = price;
  }

  for (const [k, v] of Object.entries(raw)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (HANDLED.has(k)) continue;
    payload[k] = v;
  }

  if (raw.assessment && typeof raw.assessment === 'object') {
    payload.assessment = mergeAssessment(payload.assessment, raw.assessment);
  }

  return {
    outcome: 'updated',
    repriced,
    row: {
      id,
      search_id: raw.search_id ?? existingRow.search_id ?? fallbackSearchId ?? null,
      // Never rewritten. How long something has sat unsold is worth knowing.
      first_seen: existingRow.first_seen ?? now,
      last_seen: now,
      payload,
    },
  };
}

/**
 * Merge a batch of browsed listings for one user.
 *
 * Reads only the rows in this batch. The dashboard's loadAll() pulls every
 * listing a user has ever seen, which is the right shape for scoring a whole
 * board and the wrong one for merging thirty rows.
 */
export async function ingestBatch({ userId, searchId, listings, now = new Date().toISOString() }) {
  const result = { received: listings.length, new: 0, updated: 0, repriced: [], skipped: [] };

  const usable = [];
  for (const raw of listings) {
    const id = String(raw?.id ?? '').trim();
    if (!ID_OK.test(id)) {
      result.skipped.push({ reason: 'no usable listing id', title: raw?.title ?? null });
      continue;
    }
    usable.push({ ...raw, id });
  }
  if (!usable.length) return result;

  const ids = [...new Set(usable.map((l) => l.id))];
  const existingRows = await selectForUser(
    'listings',
    userId,
    `select=id,search_id,payload,first_seen,last_seen&id=in.(${ids.join(',')})`
  );
  const byId = new Map((existingRows ?? []).map((r) => [r.id, r]));

  // Keyed by id so the same listing appearing twice in one batch merges onto
  // itself rather than reaching Postgres as two conflicting rows.
  const rows = new Map();
  for (const raw of usable) {
    const { row, outcome, repriced } = mergeListing(byId.get(raw.id) ?? null, raw, now, searchId);
    if (!rows.has(row.id)) {
      if (outcome === 'new') result.new++;
      else result.updated++;
    }
    if (repriced) result.repriced.push(repriced);
    byId.set(row.id, row);
    rows.set(row.id, { user_id: userId, ...row });
  }

  await upsert('listings', [...rows.values()]);
  return result;
}
