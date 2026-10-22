import test from "node:test";
import assert from "node:assert/strict";
import { createServer, connect } from "node:net";
import { once } from "node:events";
import {
  validateDeviceHost,
  forwardLocalPort,
} from "./device-emulator-forwarding.mjs";

test("device forwarding accepts only an explicitly assigned private interface", () => {
  const interfaces = {
    en0: [{ family: "IPv4", internal: false, address: "192.168.1.24" }],
  };
  assert.equal(validateDeviceHost("192.168.1.24", interfaces), "192.168.1.24");
  for (const host of [
    "0.0.0.0",
    "127.0.0.1",
    "8.8.8.8",
    "example.com",
    "192.168.1.25",
    "192.168.1.24\nOTHER=value",
  ])
    assert.throws(
      () => validateDeviceHost(host, interfaces),
      /assigned private/
    );
});

test("forwarding carries real TCP traffic to loopback and closes active sockets", async () => {
  const backend = createServer((socket) => socket.pipe(socket));
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const proxy = await forwardLocalPort("127.0.0.1", 0, backend.address().port);
  const client = connect(proxy.port, "127.0.0.1");
  try {
    await once(client, "connect");
    const received = once(client, "data");
    client.write("synthetic-local-test");
    assert.equal((await received)[0].toString(), "synthetic-local-test");
    const closed = once(client, "close");
    await proxy.close();
    await closed;
    assert.equal(client.destroyed, true);
    const rebound = createServer();
    rebound.listen(proxy.port, "127.0.0.1");
    await once(rebound, "listening");
    await new Promise((resolve) => rebound.close(resolve));
  } finally {
    client.destroy();
    await proxy.close();
    await new Promise((resolve) => backend.close(resolve));
  }
});
