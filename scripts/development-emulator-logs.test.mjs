import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, lstat, readFile, rm, readdir, readlink } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import path from 'node:path';
import { prepareEmulatorCommand, emulatorStatusLine } from './development-emulator-logs.mjs';
const execute = promisify(execFile);

test('CLI와 Firestore가 파일을 직접 써도 소스와 실행 폴더에 원본 로그를 보관하지 않는다', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'cp-emulator-log-test-'));
  try {
    const root = path.join(base, 'source'), directory = path.join(base, 'private-run');
    const cli = path.join(root, 'firebase/node_modules/firebase-tools/lib/bin');
    await mkdir(cli, { recursive: true });
    await mkdir(directory, { mode: 0o700 });
    await writeFile(path.join(root, 'firebase/package.json'), '{}');
    await writeFile(path.join(root, 'firebase.json'), '{}');
    await writeFile(path.join(cli, '../../package.json'), '{"name":"firebase-tools"}');
    await writeFile(path.join(cli, 'firebase.js'), `const fs = require('node:fs');
      for (const name of ['firebase-debug.log', 'firestore-debug.log']) {
        fs.writeFileSync(name, 'public-fake-auth-input');
      }`);
    const options = await prepareEmulatorCommand({ root, directory, project: 'demo-cyclepair', importDirectory: '/owned/snapshot' });
    await execute(options.command, options.args, { cwd: options.cwd });
    assert.deepEqual(await readdir(path.join(root, 'firebase')), ['node_modules', 'package.json']);
    assert.equal(options.cwd, directory);
    assert.equal(options.args[options.args.indexOf('--config') + 1], path.join(root, 'firebase.json'));
    assert.equal(options.args[options.args.indexOf('--import') + 1], '/owned/snapshot');
    for (const name of ['firebase-debug.log', 'firestore-debug.log']) {
      assert.equal((await lstat(path.join(directory, name))).isSymbolicLink(), true);
      assert.equal(await readlink(path.join(directory, name)), devNull);
      assert.equal((await readFile(path.join(directory, name))).length, 0);
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('계정과 SDK 원문 대신 고정 준비 상태만 출력한다', () => {
  for (const line of ['public-fake@example.invalid', 'public-short-password',
    'http://localhost/emulator/action?oobCode=public-code', 'SDK failed with private input'])
    assert.equal(emulatorStatusLine(line), null);
  assert.equal(emulatorStatusLine('All emulators ready: public-fake@example.invalid'), 'All local emulators ready');
});

test('기존 로그 파일을 덮어쓰거나 삭제하지 않는다', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'cp-emulator-existing-log-'));
  try {
    const root = path.join(base, 'source'), directory = path.join(base, 'private-run');
    const cli = path.join(root, 'firebase/node_modules/firebase-tools/lib/bin');
    await mkdir(cli, { recursive: true });
    await mkdir(directory, { mode: 0o700 });
    await writeFile(path.join(root, 'firebase/package.json'), '{}');
    await writeFile(path.join(cli, '../../package.json'), '{"name":"firebase-tools"}');
    await writeFile(path.join(cli, 'firebase.js'), '');
    const file = path.join(directory, 'firebase-debug.log');
    await writeFile(file, 'preserved-owned-data');
    await assert.rejects(prepareEmulatorCommand({ root, directory, project: 'demo-cyclepair' }), { code: 'EEXIST' });
    assert.equal(await readFile(file, 'utf8'), 'preserved-owned-data');
  } finally { await rm(base, { recursive: true, force: true }); }
});
