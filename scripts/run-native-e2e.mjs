import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  appendFile,
  readdir,
  rm,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
const exec = promisify(execFile);
const { values } = parseArgs({
  options: {
    backend: { type: "string" },
    ownership: { type: "string" },
    output: { type: "string" },
    maestro: { type: "string" },
    authoring: { type: "boolean", default: false },
    scope: { type: "string", default: "pair" },
    flow: { type: "string" },
    "run-id": { type: "string" },
  },
});
if (
  !["emulator", "service"].includes(values.backend) ||
  !values.ownership ||
  !values.output ||
  !values.maestro
)
  throw new Error(
    "Provide --backend emulator|service --ownership <owned-runtime.json> --output <outside-repo-dir> --maestro <binary>"
  );
const root = process.cwd();
const output = path.resolve(values.output);
if (output.startsWith(root + path.sep) || output === root)
  throw new Error("Keep execution evidence outside the source tree");
if (values.flow && (!values.authoring || !/^[a-z,-]+$/.test(values.flow)))
  throw new Error("Single-flow execution is restricted to authoring");
if (!["solo", "pair"].includes(values.scope))
  throw new Error("Use --scope solo|pair");
const ownership = JSON.parse(await readFile(values.ownership, "utf8"));
if (
  ownership.app !== "cycle-pair" ||
  ownership.backend !== values.backend ||
  !Array.isArray(ownership.runtimes) ||
  ownership.runtimes.length !== (values.scope === "solo" ? 1 : 2)
)
  throw new Error(
    "A backend-specific ownership manifest for two isolated test runtimes is required"
  );
for (const runtime of ownership.runtimes) {
  if (
    runtime.createdFor !== "cycle-pair-native-launch" ||
    runtime.allowAppDataReset !== true
  )
    throw new Error(
      "Only explicitly owned synthetic test installations may run"
    );
  if (runtime.platform === "android") {
    if (!/^emulator-\d+$/.test(runtime.deviceId))
      throw new Error("Physical Android devices are excluded");
    const { stdout } = await exec(ownership.adb || "adb", [
      "-s",
      runtime.deviceId,
      "shell",
      "getprop",
      "ro.kernel.qemu",
    ]);
    if (stdout.trim() !== "1")
      throw new Error("The selected Android runtime is not an emulator");
  } else if (runtime.platform === "ios") {
    const { stdout } = await exec("xcrun", [
      "simctl",
      "list",
      "devices",
      "available",
      "-j",
    ]);
    const device = Object.values(JSON.parse(stdout).devices)
      .flat()
      .find((item) => item.udid === runtime.deviceId);
    if (
      !device ||
      !device.name.startsWith("CyclePair_") ||
      device.state !== "Booted"
    )
      throw new Error("Use a booted, owned CyclePair iOS Simulator");
  } else throw new Error("Unknown virtual runtime");
}
const { stdout: revision } = await exec("git", ["rev-parse", "HEAD"]);
const { stdout: dirty } = await exec("git", [
  "status",
  "--porcelain",
  "--untracked-files=no",
]);
if (dirty.trim() && !values.authoring)
  throw new Error("Commit the source before a release-eligible execution");
await mkdir(output, { recursive: true, mode: 0o700 });
if (
  values["run-id"] &&
  (!values.authoring || !/^cp-[0-9]{17}-[a-f0-9]{6}$/.test(values["run-id"]))
)
  throw new Error("Only an existing synthetic authoring run ID may resume");
const runId =
  values["run-id"] ||
  `cp-${new Date().toISOString().replace(/\D/g, "")}-${randomBytes(3).toString(
    "hex"
  )}`;
const secretValues = new Set();
let invitation;
const controlKey = randomBytes(24).toString("hex");
const server = createServer(async (request, response) => {
  if (request.url !== `/${controlKey}/invitation`) {
    response.writeHead(404).end();
    return;
  }
  if (request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!/^[A-Za-z0-9_-]{43}$/.test(value.code)) {
      response.writeHead(400).end();
      return;
    }
    invitation = value.code;
    secretValues.add(invitation);
    response.writeHead(204).end();
  } else if (invitation)
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ code: invitation }));
  else response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const controlUrl = `http://127.0.0.1:${server.address().port}/${controlKey}`;
function redact(value) {
  for (const secret of secretValues)
    value = value.replaceAll(secret, "[redacted]");
  return value
    .replace(
      /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43,}(?![A-Za-z0-9_-])/g,
      "[redacted-invitation]"
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[redacted-token]"
    );
}
const scenarios = [];
async function runFlow(actor, name, featureIds) {
  const runtime = ownership.runtimes[actor];
  if (runtime.platform === "android")
    await exec(
      ownership.adb || "adb",
      ["-s", runtime.deviceId, "reverse", "tcp:8081", "tcp:8081"],
      { timeout: 30_000 }
    );
  const temporary = await mkdtemp(path.join(tmpdir(), "cyclepair-maestro-"));
  const startedAt = new Date().toISOString();
  let log = "";
  let code = 1;
  let child;
  try {
    child = spawn(
      values.maestro,
      [
        `--platform=${runtime.platform}`,
        "--device",
        runtime.deviceId,
        "test",
        "--format=NOOP",
        `--test-output-dir=${temporary}/output`,
        `--debug-output=${temporary}/debug`,
        "-e",
        `CONTROL_URL=${controlUrl}`,
        "-e",
        `SYNTHETIC_NOTE=${runId}-note`,
        "-e",
        `SYNTHETIC_EVENT=${runId}-event`,
        `e2e/flows/${name}.yaml`,
      ],
      {
        cwd: root,
        detached: runtime.platform === "ios",
        env: {
          ...process.env,
          MAESTRO_CLI_NO_ANALYTICS: "true",
          MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
          MAESTRO_DISABLE_UPDATE_CHECK: "true",
          MAESTRO_DRIVER_STARTUP_TIMEOUT: "180000",
          MAESTRO_OPTS: `${
            process.env.MAESTRO_OPTS || ""
          } -Duser.home=${temporary}/state`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let safeProgress = Promise.resolve();
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream.on("data", (chunk) => {
        log += chunk;
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop();
        if (lines.length)
          safeProgress = safeProgress.then(() =>
            appendFile(
              path.join(output, `${actor}-${name}.progress.log`),
              redact(lines.join("\n") + "\n"),
              { mode: 0o600 }
            )
          );
      });
    }
    const timeout = setTimeout(() => child.kill("SIGTERM"), 300_000);
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (status) => resolve(status ?? 1));
    });
    clearTimeout(timeout);
    await safeProgress;
    await writeFile(path.join(output, `${actor}-${name}.log`), redact(log), {
      mode: 0o600,
    });
    // Only explicit safe captures are retained. Automatic debug captures and
    // command trees, which may contain invite text, are always discarded.
    const destination = path.join(output, "screenshots", String(actor));
    await mkdir(destination, { recursive: true });
    async function retainSafeCaptures(directory) {
      for (const entry of await readdir(directory, {
        withFileTypes: true,
      }).catch(() => [])) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await retainSafeCaptures(file);
        else if (
          file.includes(
            `${path.sep}takeScreenshot${path.sep}safe${path.sep}`
          ) &&
          entry.name.endsWith(".png")
        )
          await copyFile(file, path.join(destination, entry.name));
      }
    }
    await retainSafeCaptures(path.join(temporary, "output"));
  } finally {
    // Maestro's XCTest child can outlive the CLI. Own a process group so its
    // helpers are stopped without touching any other session or the app.
    if (runtime.platform === "ios" && child?.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    await rm(temporary, { recursive: true, force: true });
  }
  scenarios.push({
    id: name,
    actor,
    featureIds,
    passed: code === 0,
    startedAt,
    completedAt: new Date().toISOString(),
  });
  console.log(`${name}, actor ${actor}: ${code === 0 ? "PASS" : "FAIL"}`);
  if (code !== 0)
    throw new Error(`Actual UI journey failed: ${name}, actor ${actor}`);
}
async function runOffline(actor) {
  const runtime = ownership.runtimes[actor];
  if (runtime.platform !== "android")
    throw new Error(
      "This offline OS control requires the owned Android emulator"
    );
  const adb = ownership.adb || "adb";
  const deviceId = runtime.deviceId;
  const readSetting = async (name) =>
    (
      await exec(
        adb,
        ["-s", deviceId, "shell", "settings", "get", "global", name],
        { timeout: 30_000 }
      )
    ).stdout.trim();
  const airplane = await readSetting("airplane_mode_on");
  const wifi = await readSetting("wifi_on");
  const mobileData = await readSetting("mobile_data");
  try {
    await exec(
      adb,
      [
        "-s",
        deviceId,
        "shell",
        "cmd",
        "connectivity",
        "airplane-mode",
        "enable",
      ],
      { timeout: 30_000 }
    );
    await exec(adb, ["-s", deviceId, "shell", "svc", "wifi", "disable"], {
      timeout: 30_000,
    });
    await exec(adb, ["-s", deviceId, "shell", "svc", "data", "disable"], {
      timeout: 30_000,
    });
    let connections = "";
    let activeDefault;
    const disconnectDeadline = Date.now() + 15_000;
    do {
      ({ stdout: connections } = await exec(
        adb,
        ["-s", deviceId, "shell", "dumpsys", "connectivity"],
        { timeout: 30_000 }
      ));
      activeDefault = connections
        .match(/Active default network: (.*)/)?.[1]
        ?.trim();
      if (
        !activeDefault ||
        activeDefault === "none" ||
        activeDefault === "null"
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } while (Date.now() < disconnectDeadline);
    if (activeDefault && !["none", "null"].includes(activeDefault))
      throw new Error(
        "The owned emulator still has an active network; offline UI was not run"
      );
    await writeFile(
      path.join(output, "offline-network.json"),
      JSON.stringify({
        activeDefaultNetwork:
          connections.match(/Active default network: (.*)/)?.[1] ?? null,
        observedAt: new Date().toISOString(),
      }),
      { mode: 0o600 }
    );
    await runFlow(actor, "offline-write", ["records"]);
  } finally {
    await exec(
      adb,
      [
        "-s",
        deviceId,
        "shell",
        "cmd",
        "connectivity",
        "airplane-mode",
        airplane === "1" ? "enable" : "disable",
      ],
      { timeout: 30_000 }
    );
    await exec(
      adb,
      [
        "-s",
        deviceId,
        "shell",
        "svc",
        "wifi",
        wifi === "1" ? "enable" : "disable",
      ],
      { timeout: 30_000 }
    );
    await exec(
      adb,
      [
        "-s",
        deviceId,
        "shell",
        "svc",
        "data",
        mobileData === "1" ? "enable" : "disable",
      ],
      { timeout: 30_000 }
    );
  }
  await runFlow(actor, "offline-reconnected", ["records"]);
}
async function runPair() {
  if (values.scope !== "pair")
    throw new Error("Pair UI requires two owned runtimes");
  await runFlow(0, "invite-send", ["pairing-sharing"]);
  await runFlow(1, "invite-receive", ["pairing-sharing"]);
  await runConnectedPair();
}
async function runConnectedPair() {
  await runFlow(0, "sharing", ["pairing-sharing"]);
  await runFlow(1, "partner-received", ["pairing-sharing"]);
  await runEventAndRevoke();
}
async function runEventAndRevoke() {
  await runFlow(0, "event-create", ["calendar"]);
  await runFlow(1, "event-received", ["calendar"]);
  await runFlow(0, "sharing-revoke", ["pairing-sharing"]);
  await runFlow(1, "partner-revoked", ["pairing-sharing"]);
  await runFlow(0, "disconnect", ["pairing-sharing"]);
  await runFlow(1, "disconnected-restart", ["pairing-sharing"]);
}
let failed;
try {
  if (values.flow) {
    for (const name of values.flow.split(",")) {
      if (name === "offline") await runOffline(0);
      else if (name === "pair-events") await runEventAndRevoke();
      else if (name === "pair-shared") await runConnectedPair();
      else if (name === "pair-connected") {
        await runFlow(1, "sharing-private", ["pairing-sharing"]);
        await runConnectedPair();
      } else if (name === "pair") {
        await runFlow(0, "cold-home", []);
        await runFlow(1, "cold-home", []);
        await runPair();
      } else await runFlow(0, name, []);
    }
  } else {
    for (const actor of ownership.runtimes.keys()) {
      await runFlow(actor, "start", ["onboarding", "privacy"]);
      await runFlow(actor, "record", ["records", "home", "calendar"]);
    }
    await runFlow(0, "language", ["settings-language"]);
    const androidActor = ownership.runtimes.findIndex(
      (runtime) => runtime.platform === "android"
    );
    if (androidActor >= 0) await runOffline(androidActor);
    if (values.scope === "pair") {
      await runPair();
    }
  }
} catch (error) {
  failed = error.message;
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  const report = {
    schemaVersion: 1,
    runId,
    sourceSha: revision.trim(),
    sourceDirty: Boolean(dirty.trim()),
    backend: values.backend,
    kind: "native-development",
    scope: values.scope,
    scenarios,
    executedScenariosPassed: !failed,
    passed: false,
    failure: failed ?? null,
    unrun: [
      "invite-expiry-reuse-ui",
      ...(scenarios.some(
        (item) => item.id === "offline-reconnected" && item.passed
      )
        ? []
        : ["offline-retry"]),
      "account-recovery-export-deletion",
      "remote-push-delivery",
      "large-text-screen-reader",
    ],
    limitations: [
      "This is an incomplete authoring journey, not full L3 release evidence.",
      "This journey does not certify the unrun required acceptance cases.",
      "Simulator APNs uses the development server; production APNs remains separate.",
    ],
  };
  await writeFile(
    path.join(output, "journey.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 }
  );
  if (failed) console.error(failed);
}
