// Local JSON store. Deliberately boring: no database, no dependencies, and every
// file is human-readable so you can fix bad data with a text editor.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = join(ROOT, 'data');

const paths = {
  listings: join(DATA, 'listings.json'),
  verdicts: join(DATA, 'verdicts.json'),
  runs: join(DATA, 'runs.json'),
  searches: join(ROOT, 'searches.json'),
};

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`${path} is not valid JSON — fix or delete it.\n  ${err.message}`);
  }
}

// Write to a temp file and rename, so an interrupted run can't leave a
// half-written store behind. A browse run can be aborted at any moment.
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
}

export const loadSearches = () => readJson(paths.searches, null);
export const loadListings = () => readJson(paths.listings, { version: 1, listings: {} });
export const saveListings = (v) => writeJson(paths.listings, v);
export const loadVerdicts = () => readJson(paths.verdicts, {});
export const saveVerdicts = (v) => writeJson(paths.verdicts, v);
export const loadRuns = () => readJson(paths.runs, { runs: [] });
export const saveRuns = (v) => writeJson(paths.runs, v);

export function saveSearches(value) {
  if (!value?.searches?.length) throw new Error('refusing to write a searches.json with no searches');
  writeJson(paths.searches, value);
}

/**
 * Fold freshly browsed listings into the store.
 *
 * Dedupe is by Marketplace listing id, which survives edits to the title and
 * price. Re-seeing a listing is not an error — it updates `last_seen` and
 * appends to price history if the seller moved the price, which is a genuine
 * buying signal worth keeping.
 */
export function ingest(rawListings, { searchId, now = new Date().toISOString() } = {}) {
  const store = loadListings();
  const result = { new: [], updated: [], repriced: [], skipped: [] };

  for (const raw of rawListings) {
    const id = String(raw.id ?? '').trim();
    if (!id) {
      result.skipped.push({ reason: 'no listing id', title: raw.title });
      continue;
    }

    const existing = store.listings[id];
    const price = normalizePrice(raw.price);

    if (!existing) {
      store.listings[id] = {
        ...raw,
        id,
        price,
        search_id: raw.search_id ?? searchId,
        first_seen: now,
        last_seen: now,
        price_history: price == null ? [] : [{ at: now, price }],
      };
      result.new.push(id);
      continue;
    }

    existing.last_seen = now;
    const lastPrice = existing.price_history?.at(-1)?.price;
    if (price != null && price !== lastPrice) {
      (existing.price_history ??= []).push({ at: now, price });
      existing.price = price;
      result.repriced.push({ id, from: lastPrice, to: price });
    }
    // Later passes often carry richer data (a detail page beats a result card),
    // so let non-empty incoming fields win. `price` is excluded on purpose: it
    // is normalized and applied above, and letting the raw value through here
    // wrote strings like "CA$300" over the number, which scores as NaN.
    for (const [k, v] of Object.entries(raw)) {
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      if (['first_seen', 'price_history', 'id', 'price'].includes(k)) continue;
      existing[k] = v;
    }
    result.updated.push(id);
  }

  saveListings(store);
  return result;
}

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

export function setVerdict(id, state) {
  const allowed = ['seen', 'dismissed', 'saved', 'none'];
  if (!allowed.includes(state)) throw new Error(`unknown verdict "${state}"`);
  const verdicts = loadVerdicts();
  if (state === 'none') delete verdicts[id];
  else verdicts[id] = { state, at: new Date().toISOString() };
  saveVerdicts(verdicts);
  return verdicts;
}
