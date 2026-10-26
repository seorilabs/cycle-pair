import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

// Execute only the original development proxy, with host fakes and no App import.
const source = readFileSync(new URL('./build.mjs', import.meta.url), 'utf8');
const start = source.indexOf('const faultable=new Set(');
const end = source.indexOf(";Object.defineProperty(window,'__cyclePairQa'", start);
assert.ok(start >= 0 && end > start, 'Original proxy boundary must be present');
const code = transformSync(
  source.slice(start, end) +
    '\nglobalThis.harness={backend,failNext,holdNext,releaseHeld,get heldOperations(){return [...held.keys()]}};',
  { loader: 'ts', target: 'es2022' },
).code;

function createHarness() {
  const writes = [];
  const calls = [];
  const result = { status: 'synced', log: null, related: [], setup: {} };
  const target = {
    async saveDailyLogChange(...args) {
      writes.push({ operation: 'saveDailyLogChange', args });
      return result;
    },
    async saveDailyLog(...args) {
      writes.push({ operation: 'saveDailyLog', args });
      return result;
    },
    async savePrivateSetup(...args) {
      writes.push({ operation: 'savePrivateSetup', args });
      return result;
    },
  };
  const context = { firebaseCyclePairBackend: target, calls, URLSearchParams, location: { search: '' } };
  runInNewContext(code, context);
  return { writes, calls, result, harness: context.harness };
}

test('daily change hold releases the original method once with unchanged arguments', async () => {
  const { harness, writes, calls, result } = createHarness();
  const change = { localDate: '2024-02-29', value: { periodStarted: true, periodEnded: true } };
  harness.holdNext('saveDailyLogChange');
  const pending = harness.backend.saveDailyLogChange('owned-fake-uid', change, 'owned-mutation');
  assert.equal(writes.length, 0);
  assert.equal(harness.heldOperations.join(','), 'saveDailyLogChange');
  assert.equal(JSON.stringify(calls), '[{"kind":"held-boundary","operation":"saveDailyLogChange"}]');
  harness.releaseHeld('saveDailyLogChange', false);
  assert.equal(await pending, result);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].args[1], change);
  assert.equal(writes[0].args[0], 'owned-fake-uid');
  assert.equal(writes[0].args[2], 'owned-mutation');
  assert.equal(harness.heldOperations.length, 0);
});

test('daily change failure is consumed once before the adapter is called', async () => {
  const { harness, writes } = createHarness();
  harness.failNext('saveDailyLogChange');
  await assert.rejects(harness.backend.saveDailyLogChange('owned-fake-uid', {}, 'one'), { code: 'unavailable' });
  assert.equal(writes.length, 0);
  await harness.backend.saveDailyLogChange('owned-fake-uid', {}, 'two');
  assert.equal(writes.length, 1);
});

test('rejecting a held daily change keeps the adapter untouched and the next retry available', async () => {
  const { harness, writes } = createHarness();
  harness.holdNext('saveDailyLogChange');
  const pending = harness.backend.saveDailyLogChange('owned-fake-uid', {}, 'one');
  harness.releaseHeld('saveDailyLogChange', true);
  await assert.rejects(pending, { code: 'unavailable' });
  assert.equal(writes.length, 0);
  await harness.backend.saveDailyLogChange('owned-fake-uid', {}, 'two');
  assert.equal(writes.length, 1);
  assert.throws(() => harness.releaseHeld('saveDailyLogChange'), /No held boundary operation/);
});

test('holding the new method does not hold or alias the legacy method or other operations', async () => {
  const { harness, writes } = createHarness();
  harness.holdNext('saveDailyLogChange');
  const pending = harness.backend.saveDailyLogChange('owned-fake-uid', {}, 'new');
  await harness.backend.saveDailyLog('owned-fake-uid', '2024-02-29', {}, 'legacy');
  await harness.backend.savePrivateSetup('owned-fake-uid', false);
  assert.equal(writes.map(x => x.operation).join(','), 'saveDailyLog,savePrivateSetup');
  assert.throws(() => harness.releaseHeld('saveDailyLog'), /No held boundary operation/);
  harness.releaseHeld('saveDailyLogChange');
  await pending;
  assert.equal(writes[2].operation, 'saveDailyLogChange');
});

test('unsupported names are rejected instead of silently bypassing the fault', () => {
  const { harness } = createHarness();
  assert.throws(() => harness.holdNext('unknown-daily-change'), /Unsupported fixture boundary/);
  assert.throws(() => harness.failNext('unknown-daily-change'), /Unsupported fixture boundary/);
});
