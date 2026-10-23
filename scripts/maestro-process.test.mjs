import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { spawnMaestroFlow } from './maestro-process.mjs';

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
