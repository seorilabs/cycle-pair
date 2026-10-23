import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { spawnMaestroFlow } from './maestro-process.mjs';
import { resolvePrivateInput } from './private-e2e-input.mjs';

const controlUrl = 'http://127.0.0.1:12345/public-fake-control-key';

test('control URL is child environment only and public argv stays intact', () => {
  const args = Object.freeze(['test', '-e', 'APP_ID=public.fake', '-e', 'SYNTHETIC_NOTE=public-fake-note']);
  const env = Object.freeze({ HOME: '/public-fake/home', MAESTRO_CONTROL_URL: 'public-parent-value' });
  const options = Object.freeze({ cwd: '/public-fake/worktree', env, stdio: ['ignore', 'pipe', 'pipe'] });
  const child = {};
  const actual = spawnMaestroFlow('public-fake-maestro', args, options, controlUrl, (binary, argv, settings) => {
    assert.equal(binary, 'public-fake-maestro');
    assert.deepEqual(argv, args);
    assert.equal(settings.env.MAESTRO_CONTROL_URL, controlUrl);
    assert.equal(settings.env.HOME, env.HOME);
    assert.equal(settings.cwd, options.cwd);
    assert.equal(settings.stdio, options.stdio);
    return child;
  });
  assert.equal(actual, child);
  assert.equal(env.MAESTRO_CONTROL_URL, 'public-parent-value');
});

test('the spawned process receives the control URL through its environment', async () => {
  const child = spawnMaestroFlow(process.execPath,
    ['-e', 'process.stdout.write(process.env.MAESTRO_CONTROL_URL)'],
    { env: {}, stdio: ['ignore', 'pipe', 'pipe'] }, controlUrl);
  const exited = once(child, 'exit');
  let output = '';
  for await (const chunk of child.stdout) output += chunk;
  assert.deepEqual(await exited, [0, null]);
  assert.equal(output, controlUrl);
});

test('account values are child-only env and both output streams are redacted', async () => {
  const input = { kind: 'account', email: 'public-fake-email@example.invalid', password: 'Public"Fake\\Pass!7' };
  const env = Object.freeze({ HOME: '/public-fake/home' });
  const args = ['-e', 'process.stdout.write(process.env.MAESTRO_TEST_ACCOUNT_EMAIL);process.stderr.write(JSON.stringify(process.env.MAESTRO_TEST_ACCOUNT_PASSWORD))'];
  const child = spawnMaestroFlow(process.execPath, args,
    { env, inputKind: 'account', privateInput: input, stdio: ['ignore', 'pipe', 'pipe'] }, controlUrl);
  const exited = once(child, 'exit');
  const read = async stream => { let text = ''; for await (const chunk of stream) text += chunk; return text; };
  const [stdout, stderr] = await Promise.all([read(child.stdout), read(child.stderr)]);
  assert.deepEqual(await exited, [0, null]);
  assert.equal(stdout, '[redacted]');
  assert.equal(stderr, '"[redacted]"');
  assert.deepEqual(Object.keys(env), ['HOME']);
  assert.ok(!args.join(' ').includes(input.email));
  assert.ok(!args.join(' ').includes(input.password));
});

test('wrong kind, missing and extra fields fail before any spawn', () => {
  const good = { kind: 'account', email: 'public-fake@example.invalid', password: 'public-fake-password' };
  for (const input of [undefined, { ...good, kind: 'invitation' }, { ...good, email: '' }, { ...good, extra: 'public-fake' }]) {
    assert.throws(() => resolvePrivateInput({ inputKind: 'account' }, input));
  }
  assert.throws(() => resolvePrivateInput({}, good));
  for (const options of [
    { inputKind: 'account', privateInput: good, env: {}, stdio: 'inherit' },
    { env: { MAESTRO_TEST_ACCOUNT_PASSWORD: 'public-fake-stale' } },
  ]) assert.throws(() => spawnMaestroFlow('public-fake', [], options, controlUrl, () => assert.fail('must not spawn')));
  assert.throws(() => spawnMaestroFlow('public-fake', ['-e', `PASSWORD=${good.password}`],
    { inputKind: 'account', privateInput: good, env: {}, stdio: ['ignore', 'pipe', 'pipe'] }, controlUrl,
    () => assert.fail('must not spawn')));
});

test('synchronous spawn errors cannot expose private input in their message or stack', () => {
  const input = { kind: 'account', email: 'public-fake-email@example.invalid', password: 'Public"Fake\\Pass!7' };
  assert.throws(() => spawnMaestroFlow('public-fake', [],
    { env: {}, inputKind: 'account', privateInput: input, stdio: ['ignore', 'pipe', 'pipe'] }, controlUrl,
    () => { throw new Error(`public fake spawn failure ${input.email} ${JSON.stringify(input.password)}`); }),
  error => {
    assert.equal(error.message, 'public fake spawn failure [redacted] "[redacted]"');
    assert.ok(!error.stack.includes(input.email));
    assert.ok(!error.stack.includes(JSON.stringify(input.password).slice(1, -1)));
    return true;
  });
});

test('child exception output also removes the email and escaped short password', async () => {
  const input = { kind: 'account', email: 'public-fake-email@example.invalid', password: 'Public"Fake\\Pass!7' };
  const child = spawnMaestroFlow(process.execPath,
    ['-e', 'throw new Error(process.env.MAESTRO_TEST_ACCOUNT_EMAIL+" "+JSON.stringify(process.env.MAESTRO_TEST_ACCOUNT_PASSWORD))'],
    { env: {}, inputKind: 'account', privateInput: input, stdio: ['ignore', 'pipe', 'pipe'] }, controlUrl);
  const exited = once(child, 'exit');
  let error = '';
  for await (const chunk of child.stderr) error += chunk;
  assert.deepEqual(await exited, [1, null]);
  for (const value of [input.email, input.password, JSON.stringify(input.password).slice(1, -1)])
    assert.ok(!error.includes(value));
  assert.ok(error.includes('Error: [redacted] "[redacted]"'));
});

for (const name of ['relay-invite', 'read-invite']) {
  test(`${name} uses the shell-imported control URL`, () => {
    let called = false;
    const context = {
      MAESTRO_CONTROL_URL: controlUrl,
      maestro: { copiedText: 'public-fake-invitation' },
      output: {},
      http: {
        post(url, options) {
          called = true;
          assert.equal(url, controlUrl + '/invitation');
          assert.equal(JSON.parse(options.body).code, 'public-fake-invitation');
        },
        get(url) {
          called = true;
          assert.equal(url, controlUrl + '/invitation');
          return { body: JSON.stringify({ code: 'public-fake-invitation' }) };
        },
      },
    };
    runInNewContext(readFileSync(new URL(`../e2e/scripts/${name}.js`, import.meta.url), 'utf8'), context);
    assert.equal(called, true);
    if (name === 'read-invite') assert.equal(context.output.invitation, 'public-fake-invitation');
  });
}
