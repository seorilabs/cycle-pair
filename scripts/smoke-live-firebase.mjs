import {createHash, randomBytes} from 'node:crypto';
import process from 'node:process';

const projectId =
  process.env.CYCLEPAIR_FIREBASE_PROJECT ?? 'seorilabs-cyclepair-prod';
const region = process.env.CYCLEPAIR_FIREBASE_REGION ?? 'asia-northeast3';
const apiKey = process.env.CYCLEPAIR_FIREBASE_WEB_API_KEY;
const adminAccessToken = process.env.CYCLEPAIR_ADMIN_ACCESS_TOKEN;
const platformBase =
  process.env.CYCLEPAIR_PLATFORM_API_BASE ??
  'https://platform-api-306278488979.asia-northeast3.run.app';

if (projectId !== 'seorilabs-cyclepair-prod') {
  throw new Error(
    'live smoke는 단일 tracked Firebase project에서만 실행할 수 있습니다.'
  );
}
if (process.env.CYCLEPAIR_ALLOW_PRODUCTION_SMOKE !== 'true') {
  throw new Error(
    '운영 smoke에는 CYCLEPAIR_ALLOW_PRODUCTION_SMOKE=true가 필요합니다.'
  );
}
if (!apiKey || !adminAccessToken) {
  throw new Error(
    'CYCLEPAIR_FIREBASE_WEB_API_KEY와 CYCLEPAIR_ADMIN_ACCESS_TOKEN이 필요합니다.'
  );
}

const firestoreBase =
  `https://firestore.googleapis.com/v1/projects/${projectId}` +
  '/databases/(default)/documents';
const callableBase = `https://${region}-${projectId}.cloudfunctions.net`;
const identityBase = 'https://identitytoolkit.googleapis.com/v1/accounts';

const created = {
  alice: null,
  bob: null,
  inviteToken: null,
  pairId: null,
  dailyLocalDate: null,
  revoked: false,
  // 계정 데이터 내보내기는 게스트를 거부하고 복구 가능한 계정만 허용하므로
  // Pair smoke와 분리된 email/password 계정을 따로 만든다.
  exporter: null,
  exporterDailyLocalDate: null,
  exportTokenHash: null,
};

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('Firebase ID token payload가 없습니다.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function documentUrl(path) {
  return `${firestoreBase}/${path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')}`;
}

function encodeValue(value) {
  if (value instanceof Date) return {timestampValue: value.toISOString()};
  if (typeof value === 'string') return {stringValue: value};
  if (typeof value === 'boolean') return {booleanValue: value};
  if (Number.isInteger(value)) return {integerValue: String(value)};
  if (typeof value === 'number') return {doubleValue: value};
  if (value === null) return {nullValue: null};
  if (Array.isArray(value)) {
    return {arrayValue: {values: value.map(encodeValue)}};
  }
  if (typeof value === 'object') {
    return {mapValue: {fields: encodeFields(value)}};
  }
  throw new Error(`지원하지 않는 Firestore 값: ${typeof value}`);
}

function encodeFields(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, encodeValue(value)])
  );
}

function seoulLocalDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function addLocalDays(localDate, days) {
  const [year, month, day] = localDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function decodeValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) {
    return (value.arrayValue.values ?? []).map(decodeValue);
  }
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  return undefined;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)])
  );
}

async function requestJson(label, url, options, expectedStatuses = [200]) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`${label}: 네트워크 요청 실패 (${error.message})`);
  }

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!expectedStatuses.includes(response.status)) {
    const reason = body?.error?.message ?? body?.error?.status ?? '응답 오류';
    throw new Error(`${label}: HTTP ${response.status} ${reason}`);
  }

  return {status: response.status, body};
}

// 내보내기 다운로드는 첨부 파일과 응답 헤더를 검증해야 하므로 JSON 파서를
// 거치지 않고 원문과 헤더를 그대로 돌려준다.
async function requestRaw(label, url, options, expectedStatuses = [200]) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`${label}: 네트워크 요청 실패 (${error.message})`);
  }
  const text = await response.text();
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${label}: HTTP ${response.status}`);
  }
  return {status: response.status, headers: response.headers, text};
}

async function createPlatformGuestAccount(label) {
  const {body: platformBody} = await requestJson(
    `${label} 플랫폼 게스트 발급`,
    `${platformBase}/v1/auth/firebase-custom-token`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seori-app': 'cycle-pair',
        'x-seori-runtime': 'live-smoke',
      },
      body: JSON.stringify({appId: 'cycle-pair'}),
    },
    [200]
  );
  const issued = platformBody?.result;
  if (!platformBody?.ok || !issued?.firebaseCustomToken || !issued?.appUserId) {
    throw new Error(`${label} 플랫폼 게스트 발급: 응답 필드 누락`);
  }

  const {body} = await requestJson(
    `${label} Firebase Custom Token 교환`,
    `${identityBase}:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        token: issued.firebaseCustomToken,
        returnSecureToken: true,
      }),
    }
  );
  const firebaseClaims = body?.idToken
    ? decodeJwtPayload(body.idToken)
    : null;
  if (firebaseClaims?.user_id !== issued.appUserId || !body?.idToken) {
    throw new Error(`${label} Firebase Custom Token 교환: UID 또는 token 누락`);
  }

  const {body: sessionBody} = await requestJson(
    `${label} 플랫폼 세션 교환`,
    `${platformBase}/v1/auth/session`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seori-app': 'cycle-pair',
      },
      body: JSON.stringify({
        appId: 'cycle-pair',
        credential: {kind: 'firebase-id-token', value: body.idToken},
      }),
    }
  );
  const session = sessionBody?.result;
  if (
    !sessionBody?.ok ||
    !session?.platformToken ||
    session.appUserId !== issued.appUserId
  ) {
    throw new Error(`${label} 플랫폼 세션 교환: 사용자 binding 불일치`);
  }
  return {
    uid: firebaseClaims.user_id,
    idToken: body.idToken,
    platformToken: session.platformToken,
  };
}

async function createDurableAccount(label) {
  // authorizeRecentDurableAccount는 anonymous와 seoriGuest custom token을
  // 거부한다. email/password 가입은 signInProvider=password와 방금 찍힌
  // auth_time을 주므로 내보내기 정책의 두 조건을 모두 만족한다.
  const suffix = randomBytes(12).toString('hex');
  const email = `live-smoke-export-${suffix}@cyclepair-smoke.invalid`;
  const password = `Smoke-${randomBytes(18).toString('base64url')}`;
  const {body} = await requestJson(
    `${label} 복구 가능한 계정 생성`,
    `${identityBase}:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email, password, returnSecureToken: true}),
    }
  );
  if (!body?.idToken || !body?.localId) {
    throw new Error(`${label} 복구 가능한 계정 생성: token 또는 UID 누락`);
  }
  const claims = decodeJwtPayload(body.idToken);
  assert(
    claims.firebase?.sign_in_provider === 'password',
    `${label} 복구 가능한 계정: signInProvider가 password가 아닙니다.`
  );
  assert(
    claims.seoriGuest !== true,
    `${label} 복구 가능한 계정: seoriGuest claim이 남아 있습니다.`
  );
  return {uid: body.localId, idToken: body.idToken, email};
}

async function deleteDurableAccount(account) {
  if (!account) return;
  await requestJson(
    'Firebase 복구 가능한 계정 정리',
    `${identityBase}:delete?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({idToken: account.idToken}),
    }
  );
}

async function deletePlatformGuestAccount(account) {
  if (!account) return;
  await requestJson(
    'Firebase 게스트 계정 정리',
    `${identityBase}:delete?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({idToken: account.idToken}),
    }
  );
  await requestJson('플랫폼 게스트 계정 정리', `${platformBase}/v1/users/me`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${account.platformToken}`,
      'x-seori-app': 'cycle-pair',
    },
  });
}

async function callFunction(name, account, data) {
  const {body} = await requestJson(`${name} 호출`, `${callableBase}/${name}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${account.idToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({data}),
  });
  if (body?.error) {
    throw new Error(`${name}: ${body.error.status ?? body.error.message}`);
  }
  const result = body?.result;
  if (!result || typeof result !== 'object') {
    throw new Error(`${name}: callable 결과 누락`);
  }
  return result;
}

async function writeDocument(path, account, fields) {
  const {updatedAt, ...persistedFields} = fields;
  assert(
    updatedAt instanceof Date,
    `${path} 쓰기에 server timestamp marker가 없습니다.`
  );
  const documentName =
    `projects/${projectId}/databases/(default)/documents/${path}`;
  await requestJson(`${path} 쓰기`, `${firestoreBase}:commit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${account.idToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      writes: [{
        update: {
          name: documentName,
          fields: encodeFields(persistedFields),
        },
        updateTransforms: [{
          fieldPath: 'updatedAt',
          setToServerValue: 'REQUEST_TIME',
        }],
      }],
    }),
  });
}

async function readDocument(path, account, expectedStatuses = [200]) {
  const {status, body} = await requestJson(
    `${path} 읽기`,
    documentUrl(path),
    {headers: {authorization: `Bearer ${account.idToken}`}},
    expectedStatuses
  );
  return {
    status,
    data: status === 200 ? decodeFields(body?.fields) : null,
  };
}

async function readDocumentAsAdmin(path, expectedStatuses = [200]) {
  const {status, body} = await requestJson(
    `${path} Admin 읽기`,
    documentUrl(path),
    {
      headers: {
        authorization: `Bearer ${adminAccessToken}`,
        'x-goog-user-project': projectId,
      },
    },
    expectedStatuses
  );
  return {
    status,
    data: status === 200 ? decodeFields(body?.fields) : null,
  };
}

async function deleteDocumentAsAdmin(path) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await requestJson(
        `${path} 정리`,
        documentUrl(path),
        {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${adminAccessToken}`,
            'x-goog-user-project': projectId,
          },
        },
        [200, 404]
      );
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await sleep(500 * (attempt + 1));
    }
  }
}

async function commitAdminDeletes(paths) {
  const documentPrefix = `projects/${projectId}/databases/(default)/documents/`;
  await requestJson('긴급 접근 차단', `${firestoreBase}:commit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminAccessToken}`,
      'content-type': 'application/json',
      'x-goog-user-project': projectId,
    },
    body: JSON.stringify({
      writes: paths.map(path => ({delete: `${documentPrefix}${path}`})),
    }),
  });
}

async function waitFor(label, read, predicate, timeoutMilliseconds = 90_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await sleep(1_500);
  }
  throw new Error(`${label}: 제한 시간 안에 수렴하지 않았습니다.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pathKind(path) {
  return path
    .split('/')
    .filter((_, index) => index % 2 === 0)
    .join('/');
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z0-9_-]{20,}/g, '<id>');
}

async function cleanup() {
  if (created.pairId && created.alice && !created.revoked) {
    try {
      await callFunction('revokePair', created.alice, {
        pairId: created.pairId,
      });
      created.revoked = true;
    } catch {
      if (created.bob) {
        await commitAdminDeletes([
          `pairs/${created.pairId}/projections/${created.alice.uid}`,
          `pairs/${created.pairId}/projections/${created.bob.uid}`,
          `pairBindings/${created.alice.uid}`,
          `pairBindings/${created.bob.uid}`,
          `pairs/${created.pairId}`,
        ]);
        created.revoked = true;
      }
    }
  }

  const securityPaths = [];
  const childPaths = [];
  const parentPaths = [];
  if (created.alice) {
    securityPaths.push(`pairBindings/${created.alice.uid}`);
    childPaths.push(`users/${created.alice.uid}/privateCycles/current`);
    if (created.dailyLocalDate) {
      childPaths.push(
        `users/${created.alice.uid}/privateDailyLogs/${created.dailyLocalDate}`
      );
    }
    parentPaths.push(`connectionStates/${created.alice.uid}`);
  }
  if (created.bob) {
    securityPaths.push(`pairBindings/${created.bob.uid}`);
    parentPaths.push(`connectionStates/${created.bob.uid}`);
  }
  if (created.inviteToken) {
    const inviteHash = createHash('sha256')
      .update(created.inviteToken)
      .digest('hex');
    parentPaths.push(`pairInvites/${inviteHash}`);
  }
  if (created.exporter) {
    if (created.exporterDailyLocalDate) {
      childPaths.push(
        `users/${created.exporter.uid}/privateDailyLogs/` +
          created.exporterDailyLocalDate
      );
    }
    // 다운로드까지 성공하면 두 문서는 이미 소비돼 없다. 중간 실패로 남은
    // 경우에만 정리 대상이 된다.
    parentPaths.push(`accountExportStates/${created.exporter.uid}`);
    if (created.exportTokenHash) {
      parentPaths.push(`accountExportTickets/${created.exportTokenHash}`);
    }
  }
  if (created.pairId && created.alice && created.bob) {
    securityPaths.push(
      `pairs/${created.pairId}/projections/${created.alice.uid}`,
      `pairs/${created.pairId}/projections/${created.bob.uid}`
    );
    childPaths.push(
      `users/${created.alice.uid}/shareSettings/${created.pairId}`,
      `users/${created.bob.uid}/shareSettings/${created.pairId}`,
      `users/${created.alice.uid}/pairMemberships/${created.pairId}`,
      `users/${created.bob.uid}/pairMemberships/${created.pairId}`,
      `users/${created.alice.uid}/cacheTombstones/${created.pairId}`,
      `users/${created.bob.uid}/cacheTombstones/${created.pairId}`
    );
    parentPaths.push(
      `pairTombstones/${created.pairId}`,
      `pairs/${created.pairId}`
    );
  }

  const documentFailures = [];
  for (const paths of [securityPaths, childPaths, parentPaths]) {
    const results = await Promise.allSettled(paths.map(deleteDocumentAsAdmin));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        documentFailures.push(
          `${pathKind(paths[index])}: ${safeErrorMessage(result.reason)}`
        );
      }
    });
  }
  const authResults = await Promise.allSettled([
    deletePlatformGuestAccount(created.alice),
    deletePlatformGuestAccount(created.bob),
    deleteDurableAccount(created.exporter),
  ]);
  const authFailures = authResults.filter(
    result => result.status === 'rejected'
  );
  if (documentFailures.length > 0 || authFailures.length > 0) {
    throw new Error(
      `테스트 정리 실패: 문서 ${documentFailures.join(', ') || '없음'}, ` +
        `계정 ${authFailures.length}개`
    );
  }
}

let smokePassed = false;
let smokeError = null;
let cleanupError = null;
try {
  created.alice = await createPlatformGuestAccount('A');
  created.bob = await createPlatformGuestAccount('B');

  const invite = await callFunction('createPairInvite', created.alice, {
    recordsCycle: true,
  });
  assert(
    typeof invite.inviteToken === 'string',
    '초대 토큰이 생성되지 않았습니다.'
  );
  created.inviteToken = invite.inviteToken;

  const accepted = await callFunction('acceptPairInvite', created.bob, {
    inviteToken: created.inviteToken,
    recordsCycle: false,
  });
  assert(typeof accepted.pairId === 'string', 'Pair ID가 생성되지 않았습니다.');
  created.pairId = accepted.pairId;

  const pairPath = `pairs/${created.pairId}`;
  const projectionPath = `${pairPath}/projections/${created.alice.uid}`;
  const settingsPath = `users/${created.alice.uid}/shareSettings/${created.pairId}`;
  const cyclePath = `users/${created.alice.uid}/privateCycles/current`;
  const asOfDate = seoulLocalDate();
  const periodStartDate = addLocalDays(asOfDate, -14);
  const nextPeriodStartDate = addLocalDays(periodStartDate, 21);
  const nextPeriodEndDate = addLocalDays(nextPeriodStartDate, 14);
  created.dailyLocalDate = asOfDate;
  const dailyPath =
    `users/${created.alice.uid}/privateDailyLogs/${created.dailyLocalDate}`;
  const cycleFields = cyclePhase => ({
    schemaVersion: 2,
    recordsCycle: true,
    consentAcceptedAt: new Date().toISOString(),
    consentVersion: '2026-08-09-v1',
    asOfDate,
    averageCycleLength: 28,
    averagePeriodLength: 5,
    periodDates: {startDate: periodStartDate},
    cyclePhase,
    nextPeriodWindow: {
      startDate: nextPeriodStartDate,
      endDate: nextPeriodEndDate,
    },
    updatedAt: new Date(),
  });
  const shareFields = enabled => ({
    schemaVersion: 1,
    cyclePhase: enabled,
    nextPeriodWindow: enabled,
    periodDates: enabled,
    moodTag: enabled,
    symptomTags: enabled,
    energyLevel: enabled,
    conditionCode: enabled,
    carePreferences: enabled,
    note: enabled,
    updatedAt: new Date(),
  });

  const pair = await readDocument(pairPath, created.bob);
  assert(pair.data?.status === 'active', '수락 후 Pair가 active가 아닙니다.');

  const initialProjection = await readDocument(projectionPath, created.bob);
  assert(initialProjection.data !== null, '초기 projection이 없습니다.');
  assert(
    !Object.hasOwn(initialProjection.data, 'periodDates') &&
      !Object.hasOwn(initialProjection.data, 'cyclePhase'),
    '기본 projection에 비공개 주기 정보가 포함됐습니다.'
  );

  await writeDocument(cyclePath, created.alice, cycleFields('luteal'));
  const deniedPrivateRead = await readDocument(cyclePath, created.bob, [403]);
  assert(
    deniedPrivateRead.status === 403,
    '상대의 private cycle 읽기가 허용됐습니다.'
  );

  const privateProjection = await waitFor(
    '기본 비공개 projection',
    () => readDocument(projectionPath, created.bob),
    projection =>
      projection.data?.generatedAt !== initialProjection.data?.generatedAt &&
      !Object.hasOwn(projection.data, 'periodDates') &&
      !Object.hasOwn(projection.data, 'cyclePhase')
  );
  assert(
    privateProjection.status === 200,
    '기본 projection을 읽을 수 없습니다.'
  );

  await writeDocument(settingsPath, created.alice, shareFields(true));
  const sharedProjection = await waitFor(
    '선택 공유 projection',
    () => readDocument(projectionPath, created.bob),
    projection =>
      projection.data?.generatedAt !== privateProjection.data?.generatedAt &&
      projection.data?.cyclePhase === 'luteal' &&
      projection.data?.periodDates?.startDate === periodStartDate
  );

  await writeDocument(cyclePath, created.alice, cycleFields('follicular'));
  const cycleProjection = await waitFor(
    'cycle trigger projection',
    () => readDocument(projectionPath, created.bob),
    projection =>
      projection.data?.generatedAt !== sharedProjection.data?.generatedAt &&
      projection.data?.cyclePhase === 'follicular'
  );

  await writeDocument(dailyPath, created.alice, {
    schemaVersion: 2,
    localDate: created.dailyLocalDate,
    lastMutationId: 'live-smoke-daily',
    moodTag: 'neutral',
    updatedAt: new Date(),
  });
  const deniedDailyRead = await readDocument(dailyPath, created.bob, [403]);
  assert(
    deniedDailyRead.status === 403,
    '상대의 private daily 읽기가 허용됐습니다.'
  );
  const dailyProjection = await waitFor(
    'daily trigger projection',
    () => readDocument(projectionPath, created.bob),
    projection =>
      projection.data?.generatedAt !== cycleProjection.data?.generatedAt &&
      projection.data?.moodTag === 'neutral'
  );

  await writeDocument(settingsPath, created.alice, shareFields(false));
  await waitFor(
    '공유 회수 projection',
    () => readDocument(projectionPath, created.bob),
    projection =>
      projection.data?.generatedAt !== dailyProjection.data?.generatedAt &&
      !Object.hasOwn(projection.data, 'periodDates') &&
      !Object.hasOwn(projection.data, 'cyclePhase') &&
      !Object.hasOwn(projection.data, 'moodTag')
  );

  const revoked = await callFunction('revokePair', created.alice, {
    pairId: created.pairId,
  });
  assert(revoked.alreadyRevoked === false, 'Pair가 새로 해제되지 않았습니다.');
  created.revoked = true;

  const deniedProjection = await readDocument(projectionPath, created.bob, [
    403,
  ]);
  assert(
    deniedProjection.status === 403,
    '해제 후 projection 접근이 허용됐습니다.'
  );

  const adminPair = await readDocumentAsAdmin(pairPath);
  assert(
    adminPair.data?.status === 'revoked',
    'Admin 기준 Pair가 revoked가 아닙니다.'
  );
  const deletedPaths = [
    projectionPath,
    `${pairPath}/projections/${created.bob.uid}`,
    settingsPath,
    `users/${created.bob.uid}/shareSettings/${created.pairId}`,
    `pairBindings/${created.alice.uid}`,
    `pairBindings/${created.bob.uid}`,
  ];
  for (const path of deletedPaths) {
    const deleted = await readDocumentAsAdmin(path, [404]);
    assert(deleted.status === 404, `${path}가 revoke 후 남아 있습니다.`);
  }

  const aliceMembership = await readDocument(
    `users/${created.alice.uid}/pairMemberships/${created.pairId}`,
    created.alice
  );
  const bobMembership = await readDocument(
    `users/${created.bob.uid}/pairMemberships/${created.pairId}`,
    created.bob
  );
  assert(
    aliceMembership.data?.status === 'revoked' &&
      bobMembership.data?.status === 'revoked',
    'revoke 후 membership mirror가 revoked가 아닙니다.'
  );

  const deniedPrivateAfterRevoke = await readDocument(cyclePath, created.bob, [
    403,
  ]);
  assert(
    deniedPrivateAfterRevoke.status === 403,
    'revoke 후 owner-private 접근이 허용됐습니다.'
  );

  const aliceTombstonePath = `users/${created.alice.uid}/cacheTombstones/${created.pairId}`;
  const bobTombstonePath = `users/${created.bob.uid}/cacheTombstones/${created.pairId}`;
  const aliceTombstone = await readDocument(aliceTombstonePath, created.alice);
  const bobTombstone = await readDocument(bobTombstonePath, created.bob);
  assert(
    aliceTombstone.data?.status === 'pending' &&
      bobTombstone.data?.status === 'pending',
    '양쪽 pending tombstone이 없습니다.'
  );
  await callFunction('acknowledgeCacheTombstone', created.alice, {
    tombstoneId: created.pairId,
  });
  await callFunction('acknowledgeCacheTombstone', created.bob, {
    tombstoneId: created.pairId,
  });
  const acknowledgedAlice = await readDocument(
    aliceTombstonePath,
    created.alice
  );
  const acknowledgedBob = await readDocument(bobTombstonePath, created.bob);
  assert(
    acknowledgedAlice.data?.status === 'acknowledged' &&
      acknowledgedBob.data?.status === 'acknowledged',
    '양쪽 tombstone acknowledgement가 저장되지 않았습니다.'
  );

  const repeatedRevoke = await callFunction('revokePair', created.bob, {
    pairId: created.pairId,
  });
  assert(repeatedRevoke.alreadyRevoked === true, 'revoke가 멱등하지 않습니다.');

  // 계정 데이터 내보내기: 발급 → 단회 다운로드 → 재사용 차단 → ticket 소멸
  created.exporter = await createDurableAccount('E');
  created.exporterDailyLocalDate = seoulLocalDate();
  await writeDocument(
    `users/${created.exporter.uid}/privateDailyLogs/` +
      created.exporterDailyLocalDate,
    created.exporter,
    {
      schemaVersion: 2,
      localDate: created.exporterDailyLocalDate,
      lastMutationId: 'live-smoke-export',
      moodTag: 'neutral',
      updatedAt: new Date(),
    }
  );

  const guestExportRejected = await requestJson(
    '게스트 내보내기 요청 차단',
    `${callableBase}/requestAccountDataExport`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${created.alice.idToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({data: {}}),
    },
    [400, 401, 403, 412, 500]
  );
  assert(
    guestExportRejected.body?.error !== undefined,
    '플랫폼 게스트가 내보내기를 발급받았습니다.'
  );

  const exportTicket = await callFunction(
    'requestAccountDataExport',
    created.exporter,
    {}
  );
  assert(
    exportTicket.exportSubjectUid === created.exporter.uid &&
      exportTicket.singleUse === true &&
      typeof exportTicket.downloadUrl === 'string',
    '내보내기 ticket 응답 필드가 계약과 다릅니다.'
  );
  const [downloadBase, downloadFragment] = exportTicket.downloadUrl.split('#');
  const exportToken = new URLSearchParams(downloadFragment ?? '').get('token');
  assert(
    typeof exportToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(exportToken),
    '내보내기 token이 fragment에 없거나 형식이 다릅니다.'
  );
  assert(
    !downloadBase.includes(exportToken),
    '내보내기 token이 URL 경로나 query에 노출됩니다.'
  );
  created.exportTokenHash = createHash('sha256')
    .update(exportToken)
    .digest('hex');

  const ticketDocument = await readDocumentAsAdmin(
    `accountExportTickets/${created.exportTokenHash}`
  );
  assert(
    ticketDocument.data?.uid === created.exporter.uid,
    '내보내기 ticket 문서가 저장되지 않았습니다.'
  );

  const bootstrap = await requestRaw('내보내기 부트스트랩', downloadBase, {
    method: 'GET',
  });
  assert(
    bootstrap.headers.get('cache-control')?.includes('no-store') === true &&
      bootstrap.headers.get('referrer-policy') === 'no-referrer' &&
      bootstrap.text.includes('location.hash'),
    '내보내기 부트스트랩 응답이 no-store fragment 계약과 다릅니다.'
  );

  const download = await requestRaw('내보내기 단회 다운로드', downloadBase, {
    method: 'POST',
    headers: {authorization: `Bearer ${exportToken}`, accept: 'application/json'},
  });
  assert(
    download.headers.get('content-disposition')?.includes('attachment') === true,
    '내보내기 다운로드가 첨부 파일로 내려오지 않습니다.'
  );
  const exportPayload = JSON.parse(download.text);
  assert(
    exportPayload.exportSubjectUid === created.exporter.uid,
    '내보내기 payload의 대상 UID가 다릅니다.'
  );
  assert(
    exportPayload.data?.privateDailyLogs?.documents?.some(
      document => document.id === created.exporterDailyLocalDate
    ) === true,
    '내보내기 payload에 작성한 일일 기록이 없습니다.'
  );

  await requestRaw(
    '내보내기 token 재사용 차단',
    downloadBase,
    {
      method: 'POST',
      headers: {authorization: `Bearer ${exportToken}`},
    },
    [404]
  );
  await requestRaw(
    '내보내기 위조 token 차단',
    downloadBase,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${randomBytes(32).toString('base64url')}`,
      },
    },
    [404]
  );

  const consumedTicket = await readDocumentAsAdmin(
    `accountExportTickets/${created.exportTokenHash}`,
    [200, 404]
  );
  assert(
    consumedTicket.status === 404,
    '사용한 내보내기 ticket이 삭제되지 않았습니다.'
  );
  const consumedState = await readDocumentAsAdmin(
    `accountExportStates/${created.exporter.uid}`,
    [200, 404]
  );
  assert(
    consumedState.status === 404,
    '내보내기 state 문서가 삭제되지 않았습니다.'
  );
  created.exportTokenHash = null;

  smokePassed = true;
  console.log(
    'PASS: 플랫폼 게스트 2개 초대·수락·기본 비공개·선택 공유·회수·해제'
  );
  console.log('PASS: cycle·daily·shareSettings projection trigger 수렴');
  console.log(
    'PASS: owner-private 접근 차단과 cache tombstone acknowledgement'
  );
  console.log(
    'PASS: 계정 데이터 내보내기 게스트 차단·fragment token 발급·단회 다운로드·' +
      '재사용 차단·ticket 소멸'
  );
} catch (error) {
  smokeError = error;
} finally {
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }
}

if (cleanupError) {
  if (smokeError) {
    throw new AggregateError(
      [smokeError, cleanupError],
      `live smoke 실패: ${smokeError.message}; ${cleanupError.message}`
    );
  }
  throw cleanupError;
}

console.log('PASS: live smoke 테스트 계정·문서 정리');
if (smokeError) throw smokeError;
if (!smokePassed) process.exitCode = 1;
