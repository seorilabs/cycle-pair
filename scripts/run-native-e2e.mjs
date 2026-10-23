import { execFile } from "node:child_process";
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
import { validatePhysicalRuntime, assertPhysicalAndroidState } from './physical-e2e-runtime.mjs';
import { runPhysicalIosFlow, validateCanaryReceipt } from './physical-ios-wrapper.mjs';
import { spawnMaestroFlow, androidAccountCanaryOptions } from './maestro-process.mjs';
import { observeAccountInputEmpty } from './android-account-ui.mjs';
import { ACCOUNT_CANARY_SCOPE } from './private-e2e-input.mjs';
import { finished } from 'node:stream/promises';
const exec = promisify(execFile);
const { values } = parseArgs({
  options: {
    backend: { type: "string" },
    ownership: { type: "string" },
    output: { type: "string" },
    maestro: { type: "string" },
    "ios-xctestrun": { type: "string" },
    "ios-input-validation": { type: "string" },
    "private-root": { type: "string" },
    authoring: { type: "boolean", default: false },
    scope: { type: "string", default: "pair" },
    flow: { type: "string" },
    "run-id": { type: "string" },
  },
});
if (
  !["emulator", "service"].includes(values.backend) ||
  !values.ownership ||
  !values.output
)
  throw new Error(
    "Provide --backend emulator|service --ownership <owned-runtime.json> --output <outside-repo-dir> and the platform UI runner"
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
    "A backend-specific manifest for the selected physical test installations is required"
  );
if (ownership.runtimes.some(runtime => runtime.platform === 'android') && !values.maestro)
  throw new Error('Android actual UI requires --maestro <binary>');
if (ownership.runtimes.some(runtime => runtime.platform === 'ios') && !values['ios-xctestrun'])
  throw new Error('Physical iPhone actual UI requires --ios-xctestrun <signed-build-for-testing>');
if (values.scope === 'pair' && ownership.runtimes.some(runtime => runtime.platform === 'ios') &&
    (ownership.runtimes[0].platform !== 'android' || ownership.runtimes[1].platform !== 'ios'))
  throw new Error('The mixed pair controller sends from Android actor 0 to iPhone actor 1');
const androidAccountInput = androidAccountCanaryOptions({ ...values, runtimes: ownership.runtimes });
for (const runtime of ownership.runtimes) {
  validatePhysicalRuntime(runtime);
  if (values.backend === 'service' && runtime.appId.endsWith('.qa'))
    throw new Error('The synthetic installation is restricted to local Firebase');
  if (runtime.platform === "android") {
    const { stdout: state } = await exec(ownership.adb || "adb", [
      '-s', runtime.deviceId, 'get-state',
    ]);
    const { stdout } = await exec(ownership.adb || "adb", [
      "-s",
      runtime.deviceId,
      "shell",
      "getprop",
      "ro.kernel.qemu",
    ]);
    assertPhysicalAndroidState(state, stdout);
  }
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
for (const value of [androidAccountInput.privateInput?.email, androidAccountInput.privateInput?.password])
  if (value) secretValues.add(value);
let invitation;
let iosInputValidation = values['ios-input-validation'];
const accountObservation = new AbortController();
const controlKey = randomBytes(24).toString("hex");
const server = createServer(async (request, response) => {
  const field = ['email', 'password', 'confirm'].find(name => request.url === `/${controlKey}/account-empty/${name}`);
  if (field && androidAccountInput.inputKind === 'account' && request.method === 'GET') {
    try {
      const result = await observeAccountInputEmpty({ adb: ownership.adb || 'adb',
        runtime: ownership.runtimes[0], field, signal: accountObservation.signal });
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(result));
    } catch {
      response.writeHead(409).end('QA account input observation unavailable');
    }
    return;
  }
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
const createdReversePorts = [];
const keyboardStates = [];
let keyboardSubtypesRestored = true;
let activeChild;
let cancelledBy;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  cancelledBy = signal;
  accountObservation.abort();
  activeChild?.kill('SIGTERM');
});
async function keyboardSetting(deviceId, name) {
  const {stdout} = await exec(ownership.adb || 'adb', ['-s', deviceId, 'shell', 'settings', 'get', 'secure', name], {timeout: 30_000});
  return stdout.trim();
}
async function connectAndroid(runtime) {
  const adb = ownership.adb || 'adb';
  const {stdout} = await exec(adb, ['-s', runtime.deviceId, 'reverse', '--list']);
  const routes = stdout.trim().split('\n').filter(Boolean).map(line => line.trim().split(/\s+/));
  const ports = values.backend === 'emulator' ? [8081, 9399, 8380, 5301] : [8081];
  for (const port of ports) {
    const socket = `tcp:${port}`;
    const existing = routes.find(route => route[1] === socket);
    if (existing && existing[2] !== socket)
      throw new Error(`Preserve the existing Android reverse connection on ${socket}`);
    if (!existing) {
      await exec(adb, ['-s', runtime.deviceId, 'reverse', socket, socket], {timeout: 30_000});
      createdReversePorts.push({deviceId: runtime.deviceId, socket});
    }
  }
  if (runtime.keyboard) {
    const method = await keyboardSetting(runtime.deviceId, 'default_input_method');
    const subtype = await keyboardSetting(runtime.deviceId, 'selected_input_method_subtype');
    if (method !== runtime.keyboard.inputMethod || !/^-?\d+$/.test(subtype) || !/^-?\d+$/.test(runtime.keyboard.asciiSubtype))
      throw new Error('Preserve the unrecognized input method or subtype');
    if (subtype !== runtime.keyboard.asciiSubtype) {
      keyboardStates.push({deviceId: runtime.deviceId, method, subtype});
      await exec(adb, ['-s', runtime.deviceId, 'shell', 'settings', 'put', 'secure', 'selected_input_method_subtype', runtime.keyboard.asciiSubtype], {timeout: 30_000});
      if (await keyboardSetting(runtime.deviceId, 'selected_input_method_subtype') !== runtime.keyboard.asciiSubtype)
        throw new Error('The explicit test input subtype was not applied');
    }
  }
}
async function runFlow(actor, name, featureIds) {
  if (cancelledBy) throw new Error(`UI execution cancelled by ${cancelledBy}`);
  const runtime = ownership.runtimes[actor];
  if (runtime.platform === 'ios') {
    const startedAt = new Date().toISOString();
    const privateRoot = path.resolve(values['private-root'] || path.dirname(values.ownership));
    let inputValidated = false;
    if (name === 'invite-receive') {
      if (!invitation || !iosInputValidation)
        throw new Error('An actual invitation and the same-candidate public-input receipt are required before iPhone acceptance');
      inputValidated = await validateCanaryReceipt({
        purpose: 'invitation',
        receipt: path.resolve(iosInputValidation),
        baseXctestrun: path.resolve(values['ios-xctestrun']),
        ownership: path.resolve(values.ownership), candidateSha: revision.trim(), privateRoot,
      });
    }
    const result = await runPhysicalIosFlow({
      baseXctestrun: path.resolve(values['ios-xctestrun']),
      ownership: path.resolve(values.ownership), privateRoot,
      output: path.join(output, `${actor}-${name}`), backend: values.backend,
      deviceId: runtime.deviceId, candidateSha: revision.trim(), runId,
      flow: name === 'invite-receive' ? 'invitation-accept' : name,
      privateInput: name === 'invite-receive' ? { kind: 'invitation', code: invitation } : undefined,
      allowSecretExecution: inputValidated, secretTransportValidated: inputValidated,
      executePhysical: true,
    });
    scenarios.push({ id: name, actor, featureIds, passed: result.passed,
      startedAt, completedAt: new Date().toISOString(), driver: 'xctest' });
    console.log(`${name}, actor ${actor}: ${result.passed ? 'PASS' : 'FAIL'}`);
    if (!result.passed) throw new Error(`Actual UI journey failed: ${name}, actor ${actor}`);
    return;
  }
  const temporary = await mkdtemp(path.join(tmpdir(), "cyclepair-maestro-"));
  const startedAt = new Date().toISOString();
  let log = "";
  let code = 1;
  let flowTimeout;
  try {
    const child = spawnMaestroFlow(
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
        `APP_ID=${runtime.appId}`,
        "-e",
        `SYNTHETIC_NOTE=${runId}-note`,
        "-e",
        `SYNTHETIC_EVENT=${runId}-event`,
        `e2e/flows/${name}.yaml`,
      ],
      {
        cwd: root,
        ...androidAccountInput,
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
      },
      controlUrl
    );
    activeChild = child;
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
    flowTimeout = setTimeout(() => child.kill("SIGTERM"), 300_000);
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (status) => resolve(status ?? 1));
    });
    await Promise.all([finished(child.stdout), finished(child.stderr)]);
    clearTimeout(flowTimeout);
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
    if (name !== 'account-input-canary') await retainSafeCaptures(path.join(temporary, "output"));
  } finally {
    clearTimeout(flowTimeout);
    activeChild = undefined;
    await rm(temporary, { recursive: true, force: true });
  }
  scenarios.push({
    id: name,
    actor,
    featureIds,
    passed: code === 0,
    startedAt,
    completedAt: new Date().toISOString(),
    ...(name === 'account-input-canary' ? { canaryScope: ACCOUNT_CANARY_SCOPE, screenshotsRetained: false } : {}),
  });
  console.log(`${name}, actor ${actor}: ${code === 0 ? "PASS" : "FAIL"}`);
  if (code !== 0)
    throw new Error(`Actual UI journey failed: ${name}, actor ${actor}`);
}
async function runOffline(actor) {
  const runtime = ownership.runtimes[actor];
  if (runtime.platform !== "android")
    throw new Error(
      "This offline OS control requires the approved physical Android device"
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
  if (![airplane, wifi, mobileData].every(value => ['0', '1'].includes(value)))
    throw new Error('Preserve unknown network settings; offline control was not started');
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
        "The selected device still has an active network; offline UI was not run"
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
  if (ownership.runtimes[1].platform === 'ios' && !iosInputValidation) {
    await runFlow(1, 'invitation-canary', []);
    iosInputValidation = path.join(output, '1-invitation-canary', 'result.json');
  }
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
  for (const runtime of ownership.runtimes) {
    if (runtime.platform === 'android') await connectAndroid(runtime);
  }
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
  accountObservation.abort();
  for (const {deviceId, method, subtype} of keyboardStates) {
    try {
      if (await keyboardSetting(deviceId, 'default_input_method') !== method)
        throw new Error('The input method changed outside this execution');
      await exec(ownership.adb || 'adb', ['-s', deviceId, 'shell', 'settings', 'put', 'secure', 'selected_input_method_subtype', subtype], {timeout: 30_000});
      if (await keyboardSetting(deviceId, 'selected_input_method_subtype') !== subtype)
        throw new Error('The original keyboard subtype was not restored');
    } catch {
      keyboardSubtypesRestored = false;
      failed ??= 'Unable to restore the original keyboard subtype';
      process.exitCode = 1;
    }
  }
  for (const {deviceId, socket} of createdReversePorts) {
    await exec(ownership.adb || 'adb', ['-s', deviceId, 'reverse', '--remove', socket])
      .catch(() => { failed ??= 'Unable to restore an owned Android reverse connection'; process.exitCode = 1; });
  }
  await new Promise((resolve) => server.close(resolve));
  const report = {
    schemaVersion: 1,
    runId,
    sourceSha: revision.trim(),
    sourceDirty: Boolean(dirty.trim()),
    backend: values.backend,
    kind: "physical-device",
    platforms: ownership.runtimes.map(runtime => runtime.platform),
    scope: values.scope,
    scenarios,
    keyboardSubtypesRestored,
    cancelledBy: cancelledBy ?? null,
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
      "Remote push delivery requires the signed target build and actual receipt on a physical device.",
    ],
  };
  await writeFile(
    path.join(output, "journey.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 }
  );
  if (failed) console.error(failed);
}
