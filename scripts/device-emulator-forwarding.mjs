import { createServer, connect } from "node:net";
import { networkInterfaces } from "node:os";

export function validateDeviceHost(host, interfaces = networkInterfaces()) {
  const parts = host.split(".");
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  const privateIPv4 =
    parts.length === 4 &&
    parts.every(
      (part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255
    ) &&
    (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  if (
    !privateIPv4 ||
    !Object.values(interfaces)
      .flat()
      .some(
        (item) =>
          item &&
          !item.internal &&
          item.family === "IPv4" &&
          item.address === host
      )
  )
    throw new Error(
      "Use an assigned private IPv4 interface for the physical test device"
    );
  return host;
}

// The caller validates the explicitly selected interface before opening ports.
export async function forwardLocalPort(host, port, targetPort = port) {
  const sockets = new Set();
  const server = createServer((client) => {
    const upstream = connect({ host: "127.0.0.1", port: targetPort });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.on("error", () => {
        client.destroy();
        upstream.destroy();
      });
    }
    client.pipe(upstream).pipe(client);
    client.once("close", () => upstream.destroy());
    upstream.once("close", () => client.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    port: server.address().port,
    async close() {
      for (const socket of sockets) socket.destroy();
      if (server.listening)
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
    },
  };
}

export async function openDeviceForwarders(host) {
  validateDeviceHost(host);
  const forwarders = [];
  try {
    for (const port of [9399, 8380, 5301])
      forwarders.push(await forwardLocalPort(host, port));
    return async () => {
      await Promise.all(forwarders.map((server) => server.close()));
    };
  } catch (error) {
    await Promise.all(forwarders.map((server) => server.close()));
    throw error;
  }
}
