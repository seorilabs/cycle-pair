import { createConnection } from 'node:net';
import { connect } from 'node:http2';
const ERROR = 'QA UI driver observation unavailable';
const MAX = 4 * 1024 * 1024;

function readStatus(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { socket.off('readable', read); socket.off('end', fail); socket.off('error', fail); };
    const fail = () => { cleanup(); reject(new Error(ERROR)); };
    const read = () => {
      const value = socket.read(4);
      if (value) { cleanup(); value.toString() === 'OKAY' ? resolve() : reject(new Error(ERROR)); }
    };
    socket.on('readable', read); socket.once('end', fail); socket.once('error', fail); read();
  });
}
function decodeHierarchy(bytes) {
  if (bytes.length < 7 || bytes[0] !== 0 || bytes.readUInt32BE(1) !== bytes.length - 5 || bytes[5] !== 10)
    throw new Error(ERROR);
  let size = 0, shift = 0, offset = 6, value;
  do {
    if (offset >= bytes.length || shift > 28) throw new Error(ERROR);
    value = bytes[offset++]; size += (value & 127) * 2 ** shift; shift += 7;
  } while (value & 128);
  if (size !== bytes.length - offset) throw new Error(ERROR);
  return bytes.subarray(offset).toString('utf8');
}

/** 기존 5037과 기본 Maestro 7001을 읽기만 한다. server start/list/forward나 새 instrumentation은 없다. */
export async function readAccountUiService({ deviceId, hierarchy = false, signal }, dependencies = {}) {
  if (signal?.aborted) throw new Error(ERROR);
  const socket = (dependencies.createConnection || createConnection)({ host: '127.0.0.1', port: 5037 });
  const abort = () => socket.destroy(new Error(ERROR));
  const timer = setTimeout(abort, 15_000);
  let session;
  socket.on('error', () => {});
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
  socket.once('close', cleanup); signal?.addEventListener('abort', abort, { once: true });
  try {
    for (const command of [`host:transport:${deviceId}`, hierarchy ? 'tcp:7001' : 'shell:dumpsys activity activities']) {
      socket.write(Buffer.from(Buffer.byteLength(command).toString(16).padStart(4, '0') + command));
      await readStatus(socket);
    }
    let stream = socket, status, grpcStatus;
    if (hierarchy) {
      session = connect('http://127.0.0.1', { createConnection: () => socket });
      session.on('error', () => {});
      stream = session.request({ ':method': 'POST', ':path': '/maestro_android.MaestroDriver/viewHierarchy',
        'grpc-timeout': '15S', 'content-type': 'application/grpc', te: 'trailers' });
      stream.on('response', headers => { status = headers[':status']; grpcStatus = headers['grpc-status']; });
      stream.on('trailers', headers => { grpcStatus = headers['grpc-status']; });
      stream.end(Buffer.alloc(5)); // ViewHierarchyRequest는 빈 protobuf 메시지다.
    }
    const chunks = []; let count = 0;
    for await (const chunk of stream) {
      count += chunk.length;
      if (count > MAX) throw new Error(ERROR);
      chunks.push(chunk);
    }
    if (hierarchy && (status !== 200 || grpcStatus !== '0')) throw new Error(ERROR);
    const value = Buffer.concat(chunks);
    return hierarchy ? decodeHierarchy(value) : value.toString('utf8');
  } catch { throw new Error(ERROR); }
  finally { cleanup(); session?.destroy(); socket.destroy(); }
}
