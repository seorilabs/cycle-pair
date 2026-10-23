import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  unlink,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  openDeviceForwarders,
  validateDeviceHost,
} from "./device-emulator-forwarding.mjs";
import { prepareEmulatorCommand, emulatorStatusLine } from "./development-emulator-logs.mjs";
const root = process.cwd();
const project = JSON.parse(
  await readFile("apps/mobile/firebase-environments.json", "utf8")
).projectId;
const { values } = parseArgs({
  options: { import: { type: "string" }, "device-host": { type: "string" } },
});
const deviceHost = values["device-host"]
  ? validateDeviceHost(values["device-host"])
  : undefined;
let importDirectory;
if (values.import) {
  importDirectory = path.resolve(values.import);
  if (importDirectory === root || importDirectory.startsWith(root + path.sep))
    throw new Error(
      "Keep synthetic emulator snapshots outside the source tree"
    );
  const ownership = JSON.parse(
    await readFile(
      path.join(importDirectory, "cyclepair-qa-owned.json"),
      "utf8"
    )
  );
  if (
    ownership.app !== "cycle-pair" ||
    ownership.projectId !== project ||
    ownership.syntheticOnly !== true
  )
    throw new Error(
      "Only an explicitly owned Cycle Pair synthetic snapshot may be imported"
    );
  await access(path.join(importDirectory, "firebase-export-metadata.json"));
}
const localFiles = [
  "firebase/functions/.secret.local",
  "firebase/functions/.env.local",
];
for (const file of localFiles) {
  try {
    await access(file);
    throw new Error(`Preserve existing ${file}; use a separate workspace`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const temporary = await mkdtemp(
  path.join(tmpdir(), "cyclepair-dev-emulators-")
);
const credentials = path.join(temporary, "no-credentials.json");
const files = [
  'APPLE_IAP_PRIVATE_KEY_BASE64=ZHVtbXk=\nAPPLE_IAP_KEY_ID=emulator-test-key\nAPPLE_IAP_ISSUER_ID=00000000-0000-0000-0000-000000000000\nAPPLE_APP_ID=1\nAPPLE_IAP_ROOT_CERTIFICATES_BASE64_JSON=["ZHVtbXk="]\n',
  "ENFORCE_APP_CHECK=false\nHTTP_PROXY=http://127.0.0.1:9\nHTTPS_PROXY=http://127.0.0.1:9\nALL_PROXY=http://127.0.0.1:9\nNO_PROXY=127.0.0.1,localhost,::1\n" +
    (deviceHost ? `CYCLEPAIR_EMULATOR_DEVICE_HOST=${deviceHost}\n` : ""),
];
const owned = [];
let child;
let closeForwarders;
let forwardingInitialization;
let forwardingFailure;
async function cleanup() {
  await forwardingInitialization;
  await closeForwarders?.();
  for (let i = 0; i < localFiles.length; i++) {
    if (
      owned.includes(i) &&
      (await readFile(localFiles[i], "utf8").catch(() => "")) === files[i]
    )
      await unlink(localFiles[i]);
  }
  await rm(temporary, { recursive: true, force: true });
}
try {
  await writeFile(
    credentials,
    '{"type":"cyclepair-emulator-no-credentials"}\n',
    { flag: "wx", mode: 0o600 }
  );
  for (let i = 0; i < localFiles.length; i++) {
    await writeFile(localFiles[i], files[i], { flag: "wx", mode: 0o600 });
    owned.push(i);
  }
  const launch = await prepareEmulatorCommand({ root, directory: temporary, project, importDirectory });
  child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      GOOGLE_APPLICATION_CREDENTIALS: credentials,
      CLOUDSDK_CONFIG: temporary,
      ENFORCE_APP_CHECK: "false",
    },
    stdio: ["inherit", "pipe", "pipe"],
  });
  // Auth output and the CLI's own debug files are separate channels.
  // Raw files go to the null device; stdout emits only fixed status metadata.
  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    stream.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        // Firebase CLI on macOS checks every listener on a port before starting.
        // Open the separate interface only after its loopback servers are ready.
        if (
          deviceHost &&
          !forwardingInitialization &&
          line.includes("All emulators ready")
        ) {
          forwardingInitialization = openDeviceForwarders(deviceHost)
            .then((close) => {
              closeForwarders = close;
              console.log("Physical device forwarding ready");
            })
            .catch((error) => {
              forwardingFailure = error;
              console.error(
                "Physical device forwarding failed; stopping the owned local servers."
              );
              child.kill("SIGINT");
            });
        }
        const status = emulatorStatusLine(line);
        if (status) console.log(status);
      }
    });
  }
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await cleanup();
  if (forwardingFailure) process.exitCode = 1;
}
