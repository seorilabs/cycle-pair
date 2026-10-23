export const PUBLIC_ACCOUNT_CANARY = Object.freeze({
  email: 'cyclepair-public-canary@example.invalid',
  password: 'CyclePair-Public-Canary!2026',
});
export const ACCOUNT_CANARY_SCOPE = Object.freeze({
  emailEvidence: 'exact-input', secureFieldEvidence: 'masked-length-only',
  passwordExactInputValidated: false, authenticationSucceeded: false, submitted: false,
});

export const IOS_ACCOUNT_CANARY_SCOPE = Object.freeze({
  ...ACCOUNT_CANARY_SCOPE, secureFieldEvidence: 'masked-nonempty-only',
});

export function resolvePrivateInput(flow, input) {
  if (flow.canaryPurpose === 'account') {
    if (input !== undefined) throw new Error('공개 계정 canary에 비공개 입력을 줄 수 없습니다');
    return { kind: 'account', values: PUBLIC_ACCOUNT_CANARY, secrets: Object.values(PUBLIC_ACCOUNT_CANARY) };
  }
  const kind = flow.inputKind || 'none';
  if (kind === 'none') {
    if (input !== undefined) throw new Error('이 흐름에는 비공개 입력을 줄 수 없습니다');
    return { kind, values: {}, secrets: flow.canaryPurpose === 'invitation' ? ['cyclepair-canary-20261023'] : [] };
  }
  const fields = kind === 'account' ? ['email', 'password'] : kind === 'invitation' ? ['code'] : kind === 'action-link' ? ['url'] : null;
  if (!fields || !input || input.kind !== kind ||
      Object.keys(input).sort().join(',') !== ['kind', ...fields].sort().join(',') ||
      fields.some(key => typeof input[key] !== 'string' || !input[key]))
    throw new Error('흐름의 비공개 입력 종류와 필드가 맞지 않습니다');
  if (fields.some(key => !input[key].isWellFormed()))
    throw new Error('비공개 입력에는 올바른 문자열이 필요합니다');
  if (kind === 'invitation' && !/^[A-Za-z0-9_-]{43}$/.test(input.code)) throw new Error('초대 형식 거절');
  const values = Object.fromEntries(fields.map(key => [key, input[key]]));
  const action = kind === 'action-link' ? parseActionLink(values.url, flow.actionMode) : null;
  return { kind, values, secrets: [...Object.values(values), ...(action ? [action.searchParams.get('oobCode'), action.searchParams.get('apiKey')] : [])] };

}

export function privateInputEnvironment(input, platform, flowName) {
  if (!['ios', 'android'].includes(platform)) throw new Error('지원하지 않는 입력 플랫폼');
  const prefix = platform === 'ios' ? 'CYCLEPAIR_TEST_' : 'MAESTRO_TEST_';
  if (input.kind === 'none') return {};
  if (input.kind === 'action-link') return { [`${prefix}ACTION_URL`]: input.values.url };
  if (input.kind === 'account') {
    const fields = flowName === 'password-reset-request' ? ['email'] : ['email', 'password'];
    return Object.fromEntries(fields.map(field => [`${prefix}ACCOUNT_${field.toUpperCase()}`, input.values[field]]));
  }
  return { [`${prefix}INVITATION`]: input.values.code };
}

function parseActionLink(value, mode) {
  const fail = () => { throw new Error('허용한 이메일 인증 action URL만 사용할 수 있습니다'); };
  if (typeof value !== 'string' || value.length > 8192 || value.trim() !== value || /[\u0000-\u0020\u007f]/.test(value)) fail();
  let url;
  try { url = new URL(value); } catch { fail(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash ||
      mode !== 'verifyEmail' || url.searchParams.get('mode') !== mode) fail();
  const allowed = new Set(['mode', 'oobCode', 'apiKey', 'lang']);
  for (const key of url.searchParams.keys())
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) fail();
  if (!/^[A-Za-z0-9_-]{6,512}$/.test(url.searchParams.get('oobCode') || '') ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(url.searchParams.get('apiKey') || '') ||
      (url.searchParams.has('lang') && !['ko', 'en'].includes(url.searchParams.get('lang')))) fail();
  return url;
}

export function assertActionLinkOrigin(input, backend, manifest) {
  const url = parseActionLink(input.values.url, 'verifyEmail');
  const expected = manifest.authActionOrigin;
  let origin;
  try { origin = new URL(expected); } catch { throw new Error('manifest의 인증 action origin이 필요합니다'); }
  const privateIPv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(origin.hostname) &&
    origin.hostname.split('.').length === 4 && origin.hostname.split('.').every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
  const local = backend === 'emulator' && origin.protocol === 'http:' && privateIPv4 && origin.port === '9399' && url.pathname === '/emulator/action';
  const service = backend === 'service' && /^[a-z0-9][a-z0-9-]{3,61}[a-z0-9]$/.test(manifest.firebaseProjectId || '') &&
    expected === `https://${manifest.firebaseProjectId}.firebaseapp.com` && url.pathname === '/__/auth/action';
  if (origin.origin !== expected || !(local || service) || url.origin !== expected ||
      typeof manifest.authActionApiKey !== 'string' || url.searchParams.get('apiKey') !== manifest.authActionApiKey)
    throw new Error('같은 manifest의 Firebase 인증 action만 허용합니다');
}
