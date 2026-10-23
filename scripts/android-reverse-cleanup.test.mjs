import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreOwnedReversePorts} from './android-reverse-cleanup.mjs';

function fixture(initial = [], options = {}) {
  const connections = new Map(initial), calls = [];
  let lists = 0;
  const exec = async (adb, args) => {
    assert.equal(adb, '/owned/adb');
    assert.deepEqual(args.slice(0, 3), ['-s', 'owned-device', 'reverse']);
    calls.push(args.slice(3));
    if (args[3] === '--list') {
      lists++;
      if (options.listFails || (options.secondListFails && lists === 2)) throw Error('lookup failed');
      if (options.malformed) return {stdout: 'not a valid route line'};
      return {stdout: [...connections].map(([a,b]) => `owned-device ${a} ${b}`).join('\n')};
    }
    assert.equal(args[3], '--remove');
    const present = connections.has(args[4]);
    if (!options.leaveRoute) connections.delete(args[4]);
    if (!present || options.removeThrows) throw Error('remove command failed');
    return {stdout: ''};
  };
  const run = () => restoreOwnedReversePorts({adb: '/owned/adb', routes: [
    {deviceId: 'owned-device', socket: 'tcp:8081'},
  ], exec});
  return {run, calls, connections};
}

test('이미 사라진 시험 연결은 목록으로 확인하고 다시 삭제하지 않는다', async () => {
  const f = fixture();
  assert.equal((await f.run()).restored, true);
  assert.deepEqual(f.calls, [['--list']]);
});
test('직접 만든 연결만 지우고 다른 연결은 보존한다', async () => {
  const f = fixture([['tcp:8081','tcp:8081'], ['tcp:9000','tcp:9001']]);
  assert.equal((await f.run()).restored, true);
  assert.deepEqual([...f.connections], [['tcp:9000','tcp:9001']]);
  assert.deepEqual(f.calls, [['--list'], ['--remove','tcp:8081'], ['--list']]);
});
test('삭제 명령 실패 뒤에도 실제 부재를 확인하면 정리가 완료된다', async () => {
  const f = fixture([['tcp:8081','tcp:8081']], {removeThrows: true});
  assert.equal((await f.run()).restored, true);
  assert.equal(f.connections.size, 0);
});
test('다른 대상으로 바뀐 연결은 보존하고 실패로 남긴다', async () => {
  const f = fixture([['tcp:8081','tcp:9001']]);
  assert.equal((await f.run()).restored, false);
  assert.deepEqual([...f.connections], [['tcp:8081','tcp:9001']]);
  assert.deepEqual(f.calls, [['--list']]);
});
test('삭제 뒤 남은 연결은 명령 성공만으로 통과시키지 않는다', async () => {
  const f = fixture([['tcp:8081','tcp:8081']], {leaveRoute: true});
  assert.equal((await f.run()).restored, false);
});
test('목록 조회 실패 때는 삭제하지 않고 실패로 남긴다', async () => {
  const f = fixture([['tcp:8081','tcp:8081']], {listFails: true});
  assert.equal((await f.run()).restored, false);
  assert.deepEqual(f.calls, [['--list']]);
});
test('삭제 뒤 목록을 확인하지 못하면 완료로 처리하지 않는다', async () => {
  const f = fixture([['tcp:8081','tcp:8081']], {secondListFails: true});
  assert.equal((await f.run()).restored, false);
  assert.equal(f.connections.size, 0);
});
test('해석할 수 없는 목록에서는 기존 연결을 보존한다', async () => {
  const f = fixture([['tcp:8081','tcp:8081']], {malformed: true});
  const result = await f.run();
  assert.equal(result.restored, false);
  assert.equal(result.observations[0].status, 'inspection-failed');
  assert.deepEqual(f.calls, [['--list']]);
  assert.equal(f.connections.size, 1);
});
test('직접 만든 연결이 없으면 기기를 조회하지 않는다', async () => {
  const result = await restoreOwnedReversePorts({adb: '/owned/adb', routes: [],
    exec: () => { throw Error('unexpected command'); }});
  assert.deepEqual(result, {restored: true, observations: []});
});
