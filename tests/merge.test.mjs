// Merge rules for ingest. Pure functions, no database — run with:
//   node tests/merge.test.mjs
//
// The two regressions below reached production once each and are the reason
// price, price_history and assessment are handled explicitly rather than
// falling through the generic "later passes carry richer data" loop.
import { mergeListing, normalizePrice } from '../web/api/_lib/listings.mjs';
import assert from 'node:assert/strict';

let pass = 0; const fail = [];
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail.push(`${name}: ${e.message}`); } };
const T0 = '2026-09-01T00:00:00.000Z', T1 = '2026-09-18T00:00:00.000Z';

t('normalizePrice', () => {
  assert.equal(normalizePrice(350), 350);
  assert.equal(normalizePrice('$1,350'), 1350);
  assert.equal(normalizePrice('CA$325'), 325);
  assert.equal(normalizePrice('Free'), 0);
  assert.equal(normalizePrice('ask'), null);
});

t('new listing stores parsed price + opens history', () => {
  const { row, outcome } = mergeListing(null, { id: 'a1', title: 'X', price: '$240' }, T0, 's1');
  assert.equal(outcome, 'new');
  assert.equal(row.payload.price, 240);
  assert.deepEqual(row.payload.price_history, [{ at: T0, price: 240 }]);
  assert.equal(row.first_seen, T0);
  assert.equal(row.search_id, 's1');
});

// bug 1: a re-ingested raw string used to overwrite the parsed number
t('re-ingest of same string price keeps a number and does not reprice', () => {
  const first = mergeListing(null, { id: 'a1', title: 'X', price: '$240' }, T0, 's1').row;
  const { row, outcome, repriced } = mergeListing(first, { id: 'a1', title: 'X', price: 'CA$240' }, T1, 's1');
  assert.equal(outcome, 'updated');
  assert.equal(typeof row.payload.price, 'number');
  assert.equal(row.payload.price, 240);
  assert.equal(repriced, null);
  assert.equal(row.payload.price_history.length, 1);
});

// bug 2: a thin second pass used to wipe the richer first pass
t('thin second pass keeps earlier assessment fields', () => {
  const first = mergeListing(null, {
    id: 'a1', title: 'X', price: 240,
    assessment: { display_title: 'Ping G400 irons', distance_km: 30, must_have: { right_handed: true, full_set: true }, confidence: 0.9 },
  }, T0, 's1').row;
  const { row } = mergeListing(first, { id: 'a1', assessment: { condition: 'good', must_have: { full_set: false } } }, T1, 's1');
  const a = row.payload.assessment;
  assert.equal(a.display_title, 'Ping G400 irons');
  assert.equal(a.distance_km, 30);
  assert.equal(a.condition, 'good');
  assert.equal(a.must_have.right_handed, true, 'untouched spec survives');
  assert.equal(a.must_have.full_set, false, 'newer spec wins');
});

t('price drop records history and keeps first_seen', () => {
  const first = mergeListing(null, { id: 'a1', price: 240 }, T0, 's1').row;
  const { row, repriced } = mergeListing(first, { id: 'a1', price: 'CA$199' }, T1, 's1');
  assert.deepEqual(repriced, { id: 'a1', from: 240, to: 199 });
  assert.equal(row.payload.price_history.length, 2);
  assert.equal(row.first_seen, T0, 'first_seen never rewritten');
  assert.equal(row.last_seen, T1);
});

t('empty incoming fields never overwrite stored ones', () => {
  const first = mergeListing(null, { id: 'a1', price: 240, description: 'long text', photos: ['p'] }, T0, 's1').row;
  const { row } = mergeListing(first, { id: 'a1', description: '', photos: [], title: 'New title' }, T1, 's1');
  assert.equal(row.payload.description, 'long text');
  assert.deepEqual(row.payload.photos, ['p']);
  assert.equal(row.payload.title, 'New title');
});

t('missing price on re-sight leaves stored price alone', () => {
  const first = mergeListing(null, { id: 'a1', price: 240 }, T0, 's1').row;
  const { row, repriced } = mergeListing(first, { id: 'a1', title: 'X' }, T1, 's1');
  assert.equal(row.payload.price, 240);
  assert.equal(repriced, null);
});

t('column fields never leak into payload', () => {
  const { row } = mergeListing(null, { id: 'a1', price: 1, search_id: 's9', first_seen: 'bogus', last_seen: 'bogus' }, T0, 's1');
  assert.equal(row.payload.first_seen, undefined);
  assert.equal(row.payload.last_seen, undefined);
  assert.equal(row.payload.id, undefined);
  assert.equal(row.search_id, 's9', 'per-listing search_id wins over the batch default');
});

console.log(`${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log('  FAIL ' + f);
process.exit(fail.length ? 1 : 0);
