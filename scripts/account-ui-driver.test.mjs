import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http2 from 'node:http2';
import { once } from 'node:events';
import { readAccountUiService } from './account-ui-driver.mjs';

const xml = '<hierarchy><node resource-id="public-fake" text=""/></hierarchy>';
function frame(text) {
  const data = Buffer.from(text), length = [];
  let n = data.length;
  do { length.push((n & 127) | (n > 127 ? 128 : 0)); n >>>= 7; } while (n);
  const proto = Buffer.concat([Buffer.from([10, ...length]), data]), prefix = Buffer.alloc(5);
  prefix.writeUInt32BE(proto.length, 1);
  return Buffer.concat([prefix, proto]);
}
async function fakeAdb(work, { grpcStatus = '0', response = frame(xml), rejectTransport = false, stall = false } = {}) {
  const commands = [], sockets = new Set(), sessions = new Set();
  const h2 = http2.createServer();
  h2.on('session', session => { sessions.add(session); session.on('error', () => {}); session.on('close', () => sessions.delete(session)); });
  h2.on('stream', (stream, headers) => {
    commands.push(headers[':path']);
    stream.on('error', () => {});
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => {
      assert.deepEqual(Buffer.concat(chunks), Buffer.alloc(5));
      stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true });
      stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': grpcStatus }));
      stream.end(response);
    });
  });
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0), count = 0;
    const read = chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4) {
        const size = parseInt(pending.subarray(0, 4).toString(), 16);
        if (pending.length < size + 4) return;
        const command = pending.subarray(4, size + 4).toString(); pending = pending.subarray(size + 4);
        commands.push(command); count++;
        if (stall) return;
        if (rejectTransport) { socket.end('FAIL0000'); return; }
        if (count === 1) { socket.write('OKAY'); continue; }
        socket.off('data', read);
        if (command === 'tcp:7001') { socket.write('OKAY'); h2.emit('connection', socket); }
        else socket.end('OKAYpublic-fake-foreground');
        return;
      }
    };
    socket.on('data', read);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const connect = options => {
    assert.deepEqual(options, { host: '127.0.0.1', port: 5037 });
    return net.createConnection({ host: '127.0.0.1', port: server.address().port });
  };
  try {
    await work({ createConnection: connect }, commands);
    let deadline;
    try {
      await Promise.race([
        Promise.all([...sockets, ...sessions].map(item => new Promise(resolve => item.once('close', resolve)))),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('소유 연결 정리 실패')), 2000); }),
      ]);
    } finally { clearTimeout(deadline); }
    assert.equal(sockets.size, 0);
    assert.equal(sessions.size, 0);
  }
  finally {
    for (const session of sessions) session.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

test('고정 단일serial과 기존UI service만 읽고 같은 가짜서버를 유지한다', async () => {
  await fakeAdb(async (dependencies, commands) => {
    for (const hierarchy of [false, true, true]) {
      const result = await readAccountUiService({ deviceId: 'public-fake-device', hierarchy }, dependencies);
      assert.equal(result, hierarchy ? xml : 'public-fake-foreground');
    }
    assert.deepEqual(commands, ['host:transport:public-fake-device', 'shell:dumpsys activity activities',
      'host:transport:public-fake-device', 'tcp:7001', '/maestro_android.MaestroDriver/viewHierarchy',
      'host:transport:public-fake-device', 'tcp:7001', '/maestro_android.MaestroDriver/viewHierarchy']);
  });
});

test('전송거부, RPC실패, 압축/잘못된frame은 원문 없는 오류로 거절한다', async () => {
  const compressed = frame(xml); compressed[0] = 1;
  for (const options of [{ rejectTransport: true }, { grpcStatus: '13' }, { response: compressed },
    { response: Buffer.from('public-fake-sensitive-error') },
    { response: Buffer.concat([frame(xml), frame(xml)]) }, { response: Buffer.alloc(4 * 1024 * 1024 + 1, 65) }])
    await fakeAdb(async dependencies => {
      await assert.rejects(readAccountUiService({ deviceId: 'public-fake-device', hierarchy: true }, dependencies),
        { message: 'QA UI driver observation unavailable' });
    }, options);
});

test('취소는 자기연결만 닫고 새서버시작이나 복구를 하지 않는다', async () => {
  await fakeAdb(async dependencies => {
    const abort = new AbortController();
    const promise = readAccountUiService({ deviceId: 'public-fake-device', hierarchy: true, signal: abort.signal }, dependencies);
    setTimeout(() => abort.abort(), 20);
    await assert.rejects(promise, { message: 'QA UI driver observation unavailable' });
  }, { stall: true });
});


test('절대 시간제한은 지연된 가짜서버 연결만 닫고 원문을 내보내지 않는다', async () => {
  await fakeAdb(async dependencies => {
    await assert.rejects(readAccountUiService({ deviceId: 'public-fake-device', hierarchy: true }, dependencies),
      { message: 'QA UI driver observation unavailable' });
  }, { stall: true });
});
