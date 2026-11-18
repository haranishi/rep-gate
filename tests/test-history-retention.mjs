import assert from 'node:assert/strict';
import { addSession, loadHistory, totalReps } from '../js/store.js';

const data = new Map();
let acceptsWrites = true;
globalThis.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem(key, value) {
    if (!acceptsWrites) throw new DOMException('Storage quota reached', 'QuotaExceededError');
    data.set(key, value);
  },
};

const record = { date: '2026-08-11', exercise: 'situp', reps: 1, seconds: 4, log: [] };
let saved;
for (let n = 1; n <= 501; n += 1) saved = addSession({ ...record, at: n });
const history = loadHistory();
console.log(`records=${history.length} total=${totalReps(history)} oldest=${history.at(-1).at}`);
assert.equal(history.length, 501);
assert.equal(totalReps(history), 501);
assert.equal(history.at(-1).at, 1);
assert.equal(saved, true);

acceptsWrites = false;
const savedOnQuota = addSession({ ...record, at: 502 });
console.log(`quota reached: saved=${savedOnQuota} records=${loadHistory().length}`);
assert.equal(savedOnQuota, false);
assert.deepEqual(loadHistory(), history);
