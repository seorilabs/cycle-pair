import {
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  mkdir,
  unlink,
  rm,
  access,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { emulatorStatusLine } from "../development-emulator-logs.mjs";

// Demo project only. This launcher never reads the production environment file.
const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../.."
);
const require = createRequire(path.join(root, "firebase/package.json"));
const local = path.join(root, "firebase/functions/.env.local");
const content =
  "ENFORCE_APP_CHECK=false\nHTTP_PROXY=http://127.0.0.1:9\nHTTPS_PROXY=http://127.0.0.1:9\nALL_PROXY=http://127.0.0.1:9\nNO_PROXY=127.0.0.1,localhost,::1\n";
await access(path.join(root, "firebase/functions/lib/index.js"));
try {
  await access(path.join(root, "firebase/functions/.secret.local"));
  throw new Error(
    "Preserve existing function secrets; use an isolated workspace."
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const run = await mkdtemp(path.join(tmpdir(), "cyclepair-rn-web-emulators-"));
let owned = false;
let child;
let proxy;
let ready = false;
try {
  await writeFile(local, content, { flag: "wx", mode: 0o600 });
  owned = true;
  await writeFile(
    path.join(run, "no-credentials.json"),
    '{"type":"cyclepair-emulator-no-credentials"}\n',
    { mode: 0o600 }
  );
  // firebase-tools resolves an absolute functions source below projectDir.
  const alias = path.join(run, root.slice(1), "firebase/functions");
  await mkdir(path.dirname(alias), { recursive: true });
  await symlink(path.join(root, "firebase/functions"), alias);
  const ports = {
    auth: 9599,
    firestore: 8530,
    functions: 5501,
    hub: 4540,
    logging: 4640,
    eventarc: 9300,
    tasks: 9500,
  };
  // The CLI uses CONNECT even for local trigger registration. Permit only
  // this task's loopback ports while denying every external destination.
  proxy = http.createServer((_request, response) => {
    response.writeHead(403);
    response.end();
  });
  proxy.on("connect", (request, socket, head) => {
    let target;
    try {
      target = new URL(`http://${request.url}`);
    } catch {
      socket.destroy();
      return;
    }
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
      !Object.values(ports).includes(Number(target.port))
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = net.connect(Number(target.port), "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(8589, "127.0.0.1", resolve);
  });
  const config = {
    firestore: {
      rules: path.join(root, "firebase/firestore.rules"),
      indexes: path.join(root, "firebase/firestore.indexes.json"),
    },
    functions: [
      {
        source: path.join(root, "firebase/functions"),
        codebase: "cyclepair",
        runtime: "nodejs22",
      },
    ],
    emulators: {
      ...Object.fromEntries(
        Object.entries(ports).map(([name, port]) => [
          name,
          { host: "127.0.0.1", port },
        ])
      ),
      ui: { enabled: false },
      singleProjectMode: true,
    },
  };
  config.emulators.firestore.websocketPort = 9151;
  await writeFile(path.join(run, "firebase.json"), JSON.stringify(config));
  for (const file of ["firebase-debug.log", "firestore-debug.log"])
    await symlink("/dev/null", path.join(run, file));
  const env = { ...process.env };
  for (const key of [
    "FIREBASE_TOKEN",
    "GOOGLE_OAUTH_ACCESS_TOKEN",
    "GCLOUD_ACCESS_TOKEN",
    "GOOGLE_CREDENTIALS",
    "GOOGLE_ACCESS_TOKEN",
    "FIREBASE_CONFIG",
  ])
    delete env[key];
  Object.assign(env, {
    GOOGLE_APPLICATION_CREDENTIALS: path.join(run, "no-credentials.json"),
    CLOUDSDK_CONFIG: run,
    XDG_CONFIG_HOME: run,
    GCLOUD_PROJECT: "demo-cyclepair",
    GOOGLE_CLOUD_PROJECT: "demo-cyclepair",
    ENFORCE_APP_CHECK: "false",
    FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "127.0.0.1,localhost,::1",
  });
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"])
    env[key] = "http://127.0.0.1:8589";
  child = spawn(
    process.execPath,
    [
      require.resolve("firebase-tools/lib/bin/firebase.js"),
      "--config",
      path.join(run, "firebase.json"),
      "emulators:start",
      "--only",
      "auth,firestore,functions",
      "--project",
      "demo-cyclepair",
      "--non-interactive",
    ],
    { cwd: run, env, stdio: ["ignore", "pipe", "pipe"] }
  );
  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    stream.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        const status = emulatorStatusLine(line);
        if (status) {
          ready = true;
          console.log(status);
        }
        // Only fixed startup categories, never arbitrary Auth/function output.
        if (line.includes("already in use"))
          console.error("Emulator port is already in use.");
        if (line.includes("Failed to load function"))
          console.error("Candidate function definitions did not load.");
        if (!ready && line.includes("Error:"))
          console.error(
            "Local emulator startup failed. Check the demo ports and candidate function build."
          );
      }
    });
  }
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill("SIGINT"));
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("exit", (code) => resolve(code ?? 1));
    child.once("error", reject);
  });
} finally {
  proxy?.closeAllConnections();
  proxy?.close();
  if (owned && (await readFile(local, "utf8").catch(() => "")) === content)
    await unlink(local);
  await rm(run, { recursive: true, force: true });
}
