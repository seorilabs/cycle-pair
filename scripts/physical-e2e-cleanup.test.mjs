import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
for (const termination of ['failure', 'signal']) test(`UI ${termination} restores the keyboard and only the reverse routes it created`, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cyclepair-device-cleanup-test-'));
  try {
    const stateFile = path.join(directory, 'state.json');
    await writeFile(stateFile, JSON.stringify({method: 'synthetic.keyboard/IME', subtype: '10', routes: {'tcp:9999': 'tcp:9998'}}));
    const adb = path.join(directory, 'fake-adb');
    await writeFile(adb, `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.CYCLEPAIR_FAKE_ADB_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(4);
if (args[0] === 'get-state') console.log('device');
else if (args.join(' ') === 'shell getprop ro.kernel.qemu') console.log('0');
else if (args[0] === 'reverse') {
  if (args[1] === '--list') for (const [a,b] of Object.entries(state.routes)) console.log('UsbFfs '+a+' '+b);
  else if (args[1] === '--remove') delete state.routes[args[2]];
  else state.routes[args[1]] = args[2];
} else if (args.slice(0,4).join(' ') === 'shell settings get secure') console.log(args[4] === 'default_input_method' ? state.method : state.subtype);
else if (args.slice(0,5).join(' ') === 'shell settings put secure selected_input_method_subtype') state.subtype = args[5];
else throw new Error('Unexpected mock device operation');
fs.writeFileSync(file, JSON.stringify(state));
`, {mode: 0o700});
    const maestro = path.join(directory, 'fake-maestro');
    await writeFile(maestro, `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.CYCLEPAIR_FAKE_ADB_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
state.subtypeObservedDuringUI = state.subtype;
fs.writeFileSync(file, JSON.stringify(state));
if (process.env.CYCLEPAIR_FAKE_UI_TERMINATION === 'signal') {
  process.kill(process.ppid, 'SIGTERM');
  setTimeout(() => process.exit(7), 1000);
} else process.exit(7);
`, {mode: 0o700});
    const manifest = path.join(directory, 'runtime.json');
    await writeFile(manifest, JSON.stringify({app: 'cycle-pair', backend: 'emulator', adb, runtimes: [{platform: 'android', kind: 'physical', deviceId: 'synthetic-device', appId: 'com.seorilabs.cyclepair.qa', createdFor: 'cycle-pair-native-launch', authorized: true, appData: 'synthetic', keyboard: {inputMethod: 'synthetic.keyboard/IME', asciiSubtype: '20'}}]}));
    const output = path.join(directory, 'output');
    await assert.rejects(exec(process.execPath, ['scripts/run-native-e2e.mjs', '--backend', 'emulator', '--scope', 'solo', '--authoring', '--flow', 'cold-home', '--ownership', manifest, '--output', output, '--maestro', maestro], {env: {...process.env, CYCLEPAIR_FAKE_ADB_STATE: stateFile, CYCLEPAIR_FAKE_UI_TERMINATION: termination}, timeout: 30_000}));
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(state.subtypeObservedDuringUI, '20');
    assert.equal(state.subtype, '10');
    assert.equal(state.method, 'synthetic.keyboard/IME');
    assert.deepEqual(state.routes, {'tcp:9999': 'tcp:9998'});
    const report = JSON.parse(await readFile(path.join(output, 'journey.json'), 'utf8'));
    assert.equal(report.passed, false);
    assert.equal(report.executedScenariosPassed, false);
    assert.equal(report.keyboardSubtypesRestored, true);
  } finally { await rm(directory, {recursive: true, force: true}); }
});
