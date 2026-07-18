import {constants} from 'node:fs';
import {
  access,
  mkdtemp,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const firebaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const secretPath = join(firebaseRoot, 'functions', '.secret.local');
const environmentPath = join(firebaseRoot, 'functions', '.env.local');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'cyclepair-emulator-'));
const credentialPath = join(temporaryRoot, 'no-google-credentials.json');

const dummySecrets = [
  'APPLE_IAP_PRIVATE_KEY_BASE64=ZHVtbXk=',
  'APPLE_IAP_KEY_ID=emulator-test-key',
  'APPLE_IAP_ISSUER_ID=00000000-0000-0000-0000-000000000000',
  'APPLE_APP_ID=1',
  'APPLE_IAP_ROOT_CERTIFICATES_BASE64_JSON=["ZHVtbXk="]',
  '',
].join('\n');
const isolatedEnvironment = [
  'ENFORCE_APP_CHECK=false',
  'HTTP_PROXY=http://127.0.0.1:9',
  'HTTPS_PROXY=http://127.0.0.1:9',
  'ALL_PROXY=http://127.0.0.1:9',
  'NO_PROXY=127.0.0.1,localhost,::1',
  '',
].join('\n');

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if ((await pathExists(secretPath)) || (await pathExists(environmentPath))) {
  await rm(temporaryRoot, {recursive: true, force: true});
  throw new Error(
    'Refusing to run hermetic emulator tests while functions/.secret.local or functions/.env.local already exists.',
  );
}

let secretCreated = false;
let environmentCreated = false;
try {
  await writeFile(secretPath, dummySecrets, {flag: 'wx', mode: 0o600});
  secretCreated = true;
  await writeFile(environmentPath, isolatedEnvironment, {
    flag: 'wx',
    mode: 0o600,
  });
  environmentCreated = true;
  await writeFile(
    credentialPath,
    '{"type":"cyclepair-emulator-test-no-credentials"}\n',
    {flag: 'wx', mode: 0o600},
  );

  const child = spawn(
    'pnpm',
    [
      'exec',
      'firebase',
      '--config',
      '../firebase.json',
      'emulators:exec',
      '--only',
      'auth,firestore,functions',
      '--project',
      'demo-cyclepair',
      '--',
      'pnpm test:functions:emulator:inner',
    ],
    {
      cwd: firebaseRoot,
      env: {
        ...process.env,
        GOOGLE_APPLICATION_CREDENTIALS: credentialPath,
        CLOUDSDK_CONFIG: temporaryRoot,
        GOOGLE_CLOUD_PROJECT: 'demo-cyclepair',
        GCLOUD_PROJECT: 'demo-cyclepair',
        ENFORCE_APP_CHECK: 'false',
      },
      stdio: 'inherit',
    },
  );

  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  if (secretCreated) await unlink(secretPath).catch(() => undefined);
  if (environmentCreated) {
    await unlink(environmentPath).catch(() => undefined);
  }
  await rm(temporaryRoot, {recursive: true, force: true});
}
