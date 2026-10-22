import {readFile, writeFile, unlink, mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';

// A separate local installation preserves retained Play-signed application data.
// It has no provider registration and cannot initialize the service runtime.
const mobile = path.resolve('apps/mobile/android');
const clientFile = path.join(mobile, 'app/src/debug/google-services.json');
const config = JSON.parse(await readFile(path.join(mobile, 'app/google-services.json'), 'utf8'));
const client = config.client?.find(item => item.client_info?.android_client_info?.package_name === 'com.seorilabs.cyclepair');
if (config.project_info?.project_id !== 'seorilabs-cyclepair-prod' || !client)
  throw new Error('Use the existing registered Cycle Pair Firebase client configuration');
config.client = [structuredClone(client)];
config.client[0].client_info.android_client_info.package_name = 'com.seorilabs.cyclepair.qa';
const contents = JSON.stringify(config);
await mkdir(path.dirname(clientFile), {recursive: true});
await writeFile(clientFile, contents, {flag: 'wx', mode: 0o600});
try {
  const child = spawn('./gradlew', [':app:assembleDebug', '-PcyclepairSyntheticQa=true', '-PreactNativeArchitectures=arm64-v8a', '--max-workers=2'], {cwd: mobile, stdio: 'inherit'});
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  process.exitCode = code ?? 1;
} finally {
  if (await readFile(clientFile, 'utf8').catch(() => '') === contents) await unlink(clientFile);
}
