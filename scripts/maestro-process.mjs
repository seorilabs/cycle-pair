import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { resolvePrivateInput, privateInputEnvironment } from './private-e2e-input.mjs';
import { createStreamRedactor } from './physical-ios-wrapper.mjs';

export function spawnMaestroFlow(binary, args, options, controlUrl, spawnProcess = spawn) {
  const { privateInput, inputKind = 'none', ...childOptions } = options;
  if (['MAESTRO_TEST_ACCOUNT_EMAIL', 'MAESTRO_TEST_ACCOUNT_PASSWORD', 'MAESTRO_TEST_INVITATION']
    .some(key => options.env?.[key] !== undefined)) throw new Error('입력은 부모 환경 대신 typed private input으로 전달해야 합니다');
  const input = resolvePrivateInput({ inputKind }, privateInput);
  if (input.secrets.some(value => [binary, ...args, options.cwd].some(arg => typeof arg === 'string' && arg.includes(value))))
    throw new Error('비공개 입력을 명령 인수나 경로에 넣을 수 없습니다');
  if (input.secrets.length && (options.stdio?.[1] !== 'pipe' || options.stdio?.[2] !== 'pipe'))
    throw new Error('비공개 입력의 출력은 가림 가능한 pipe만 허용합니다');
  const redactors = Object.fromEntries(input.secrets.length
    ? ['stdout', 'stderr'].map(name => [name, createStreamRedactor(input.secrets)]) : []);
  let child;
  try {
    child = spawnProcess(binary, args, {
      ...childOptions,
      env: { ...childOptions.env, ...privateInputEnvironment(input, 'android'), MAESTRO_CONTROL_URL: controlUrl },
    });
  } catch (error) {
    const redactor = redactors.stderr || createStreamRedactor();
    throw new Error(redactor.push(error?.message || '입력 도구 실행 오류') + redactor.end());
  }
  for (const name of input.secrets.length ? ['stdout', 'stderr'] : []) {
    const redactor = redactors[name];
    child[name] = child[name].pipe(new Transform({
      transform(chunk, _encoding, done) { done(null, redactor.push(chunk)); },
      flush(done) { done(null, redactor.end()); },
    }));
  }
  return child;
}
