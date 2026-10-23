import { fileURLToPath } from 'node:url';
import { validatePhysicalRuntime } from './physical-e2e-runtime.mjs';
import { readAccountUiService } from './account-ui-driver.mjs';
import { runOwnedCommand } from './physical-ios-wrapper.mjs';

const PACKAGE = 'com.seorilabs.cyclepair.qa';
export const ANDROID_ACCOUNT_INPUT_FIELDS = Object.freeze(['email', 'password', 'confirm', 'login-email', 'login-password', 'reauth-password']);

function assertForeground(value, appId) {
  const resumed = [...value.matchAll(/(?:topResumedActivity=|mResumedActivity:)\s*ActivityRecord\{[^\r\n}]*\s([\w.]+)\/[^\s}]+/g)];
  if (!resumed.length || resumed.some(match => match[1] !== appId)) throw new Error();
}

/** 정상 UI의 고정 ID 하나만 관찰한다. 원시 stdout/stderr를 반환하거나 예외에 붙이지 않는다. */
async function observeInputEmpty({ runtime, field, driverPort, signal }, dependencies, recordNote) {
  const ERROR = recordNote ? '기록 메모의 빈값을 확인하지 못했습니다' : 'QA 계정 입력의 빈값을 확인하지 못했습니다';
  const command = dependencies.runCommand || runOwnedCommand;
  const readUiService = dependencies.readUiService || readAccountUiService;
  const controller = new AbortController();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  async function capture(binary, args, input) {
    if (combinedSignal.aborted) throw new Error(ERROR);
    const chunks = [];
    let bytes = 0;
    const result = await command(binary, args, {
      input, signal: combinedSignal, timeoutMs: 30_000,
      onStdout(chunk) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4 * 1024 * 1024) controller.abort();
        else chunks.push(Buffer.from(chunk));
      },
      onStderr() {},
    });
    if (result.code !== 0 || result.timedOut || !result.ownedGroupCleaned || combinedSignal.aborted)
      throw new Error(ERROR);
    return Buffer.concat(chunks).toString('utf8');
  }
  try {
    validatePhysicalRuntime(runtime);
    if (runtime.platform !== 'android' ||
        (recordNote ? field !== 'record-note' : runtime.appId !== PACKAGE || !ANDROID_ACCOUNT_INPUT_FIELDS.includes(field)) ||
        !Number.isInteger(driverPort) || driverPort < 1 || driverPort > 65535) throw new Error(ERROR);
    const observation = { deviceId: runtime.deviceId, driverPort, signal: combinedSignal };
    assertForeground(await readUiService(observation), runtime.appId);
    const xml = await readUiService({ ...observation, hierarchy: true });
    assertForeground(await readUiService(observation), runtime.appId);
    const result = JSON.parse(await capture('/usr/bin/python3',
      [fileURLToPath(new URL('./read-account-ui.py', import.meta.url)), field, runtime.appId], xml));
    if (Object.keys(result).length !== 1 || typeof result.empty !== 'boolean') throw new Error(ERROR);
    return result;
  } catch {
    // spawn/파서 오류에 원문 XML이나 다른 앱 화면이 포함되어도 밖으로 전달하지 않는다.
    throw new Error(ERROR);
  } finally { controller.abort(); }
}

export function observeAccountInputEmpty(options, dependencies = {}) {
  return observeInputEmpty(options, dependencies, false);
}

export function observeRecordNoteEmpty(options, dependencies = {}) {
  return observeInputEmpty({ ...options, field: 'record-note' }, dependencies, true);
}

export function allowsRecordNoteObservation(flow) {
  return flow === 'record' || flow === 'solo-record-language';
}
