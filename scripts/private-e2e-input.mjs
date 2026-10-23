export const PUBLIC_ACCOUNT_CANARY = Object.freeze({
  email: 'cyclepair-public-canary@example.invalid',
  password: 'CyclePair-Public-Canary!2026',
});
export const ACCOUNT_CANARY_SCOPE = Object.freeze({
  emailEvidence: 'exact-input', secureFieldEvidence: 'masked-length-only',
  passwordExactInputValidated: false, authenticationSucceeded: false, submitted: false,
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
  const fields = kind === 'account' ? ['email', 'password'] : kind === 'invitation' ? ['code'] : null;
  if (!fields || !input || input.kind !== kind ||
      Object.keys(input).sort().join(',') !== ['kind', ...fields].sort().join(',') ||
      fields.some(key => typeof input[key] !== 'string' || !input[key]))
    throw new Error('흐름의 비공개 입력 종류와 필드가 맞지 않습니다');
  if (kind === 'invitation' && !/^[A-Za-z0-9_-]{43}$/.test(input.code)) throw new Error('초대 형식 거절');
  const values = Object.fromEntries(fields.map(key => [key, input[key]]));
  return { kind, values, secrets: Object.values(values) };
}

export function privateInputEnvironment(input, platform) {
  if (!['ios', 'android'].includes(platform)) throw new Error('지원하지 않는 입력 플랫폼');
  const prefix = platform === 'ios' ? 'CYCLEPAIR_TEST_' : 'MAESTRO_TEST_';
  if (input.kind === 'none') return {};
  return input.kind === 'account'
    ? { [`${prefix}ACCOUNT_EMAIL`]: input.values.email, [`${prefix}ACCOUNT_PASSWORD`]: input.values.password }
    : { [`${prefix}INVITATION`]: input.values.code };
}
