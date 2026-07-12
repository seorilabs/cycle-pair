import {createHash} from 'node:crypto';
import process from 'node:process';

const projectId = process.env.MOONMATE_FIREBASE_PROJECT;
const region = process.env.MOONMATE_FIREBASE_REGION ?? 'asia-northeast3';
const apiKey = process.env.MOONMATE_FIREBASE_WEB_API_KEY;
const adminAccessToken = process.env.MOONMATE_ADMIN_ACCESS_TOKEN;

if (projectId !== 'seorilabs-moonmate-dev') {
  throw new Error('live smoke는 seorilabs-moonmate-dev에서만 실행할 수 있습니다.');
}
if (!apiKey || !adminAccessToken) {
  throw new Error(
    'MOONMATE_FIREBASE_WEB_API_KEY와 MOONMATE_ADMIN_ACCESS_TOKEN이 필요합니다.',
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
  revoked: false,
};

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
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
    Object.entries(record).map(([key, value]) => [key, encodeValue(value)]),
  );
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
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
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

async function createAnonymousAccount(label) {
  const {body} = await requestJson(
    `${label} 익명 인증`,
    `${identityBase}:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({returnSecureToken: true}),
    },
  );
  if (!body?.localId || !body?.idToken) {
    throw new Error(`${label} 익명 인증: 응답 필드 누락`);
  }
  return {uid: body.localId, idToken: body.idToken};
}

async function deleteAnonymousAccount(account) {
  if (!account) return;
  await requestJson(
    '익명 계정 정리',
    `${identityBase}:delete?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({idToken: account.idToken}),
    },
  );
}

async function callFunction(name, account, data) {
  const {body} = await requestJson(
    `${name} 호출`,
    `${callableBase}/${name}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${account.idToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({data}),
    },
  );
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
  await requestJson(
    `${path} 쓰기`,
    documentUrl(path),
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${account.idToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({fields: encodeFields(fields)}),
    },
  );
}

async function readDocument(path, account, expectedStatuses = [200]) {
  const {status, body} = await requestJson(
    `${path} 읽기`,
    documentUrl(path),
    {headers: {authorization: `Bearer ${account.idToken}`}},
    expectedStatuses,
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
    expectedStatuses,
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
        [200, 404],
      );
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await sleep(500 * (attempt + 1));
    }
  }
}

async function commitAdminDeletes(paths) {
  const documentPrefix =
    `projects/${projectId}/databases/(default)/documents/`;
  await requestJson(
    '긴급 접근 차단',
    `${firestoreBase}:commit`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminAccessToken}`,
        'content-type': 'application/json',
        'x-goog-user-project': projectId,
      },
      body: JSON.stringify({
        writes: paths.map(path => ({delete: `${documentPrefix}${path}`})),
      }),
    },
  );
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
      await callFunction('revokePair', created.alice, {pairId: created.pairId});
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
    childPaths.push(
      `users/${created.alice.uid}/privateCycles/current`,
      `users/${created.alice.uid}/privateDailyLogs/live-smoke`,
    );
    parentPaths.push(
      `connectionStates/${created.alice.uid}`,
    );
  }
  if (created.bob) {
    securityPaths.push(`pairBindings/${created.bob.uid}`);
    parentPaths.push(
      `connectionStates/${created.bob.uid}`,
    );
  }
  if (created.inviteToken) {
    const inviteHash = createHash('sha256')
      .update(created.inviteToken)
      .digest('hex');
    parentPaths.push(`pairInvites/${inviteHash}`);
  }
  if (created.pairId && created.alice && created.bob) {
    securityPaths.push(
      `pairs/${created.pairId}/projections/${created.alice.uid}`,
      `pairs/${created.pairId}/projections/${created.bob.uid}`,
    );
    childPaths.push(
      `users/${created.alice.uid}/shareSettings/${created.pairId}`,
      `users/${created.bob.uid}/shareSettings/${created.pairId}`,
      `users/${created.alice.uid}/pairMemberships/${created.pairId}`,
      `users/${created.bob.uid}/pairMemberships/${created.pairId}`,
      `users/${created.alice.uid}/cacheTombstones/${created.pairId}`,
      `users/${created.bob.uid}/cacheTombstones/${created.pairId}`,
    );
    parentPaths.push(
      `pairTombstones/${created.pairId}`,
      `pairs/${created.pairId}`,
    );
  }

  const documentFailures = [];
  for (const paths of [securityPaths, childPaths, parentPaths]) {
    const results = await Promise.allSettled(paths.map(deleteDocumentAsAdmin));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        documentFailures.push(
          `${pathKind(paths[index])}: ${safeErrorMessage(result.reason)}`,
        );
      }
    });
  }
  const authResults = await Promise.allSettled([
    deleteAnonymousAccount(created.alice),
    deleteAnonymousAccount(created.bob),
  ]);
  const authFailures = authResults.filter(result => result.status === 'rejected');
  if (documentFailures.length > 0 || authFailures.length > 0) {
    throw new Error(
      `테스트 정리 실패: 문서 ${documentFailures.join(', ') || '없음'}, ` +
        `계정 ${authFailures.length}개`,
    );
  }
}

let smokePassed = false;
let smokeError = null;
let cleanupError = null;
try {
  created.alice = await createAnonymousAccount('A');
  created.bob = await createAnonymousAccount('B');

  const invite = await callFunction('createPairInvite', created.alice, {
    recordsCycle: true,
  });
  assert(typeof invite.inviteToken === 'string', '초대 토큰이 생성되지 않았습니다.');
  created.inviteToken = invite.inviteToken;

  const accepted = await callFunction('acceptPairInvite', created.bob, {
    inviteToken: created.inviteToken,
    recordsCycle: false,
  });
  assert(typeof accepted.pairId === 'string', 'Pair ID가 생성되지 않았습니다.');
  created.pairId = accepted.pairId;

  const pairPath = `pairs/${created.pairId}`;
  const projectionPath = `${pairPath}/projections/${created.alice.uid}`;
  const settingsPath =
    `users/${created.alice.uid}/shareSettings/${created.pairId}`;
  const cyclePath = `users/${created.alice.uid}/privateCycles/current`;
  const dailyPath =
    `users/${created.alice.uid}/privateDailyLogs/live-smoke`;

  const pair = await readDocument(pairPath, created.bob);
  assert(pair.data?.status === 'active', '수락 후 Pair가 active가 아닙니다.');

  const initialProjection = await readDocument(projectionPath, created.bob);
  assert(initialProjection.data !== null, '초기 projection이 없습니다.');
  assert(
    !Object.hasOwn(initialProjection.data, 'periodDates') &&
      !Object.hasOwn(initialProjection.data, 'cyclePhase'),
    '기본 projection에 비공개 주기 정보가 포함됐습니다.',
  );

  await writeDocument(cyclePath, created.alice, {
    periodDates: {startDate: '2026-07-10'},
    cyclePhase: 'luteal',
    updatedAt: new Date(),
  });
  const deniedPrivateRead = await readDocument(
    cyclePath,
    created.bob,
    [403],
  );
  assert(deniedPrivateRead.status === 403, '상대의 private cycle 읽기가 허용됐습니다.');

  const privateProjection = await waitFor(
    '기본 비공개 projection',
    () => readDocument(projectionPath, created.bob),
    projection =>
      projection.data?.generatedAt !== initialProjection.data?.generatedAt &&
      !Object.hasOwn(projection.data, 'periodDates') &&
      !Object.hasOwn(projection.data, 'cyclePhase'),
  );
  assert(privateProjection.status === 200, '기본 projection을 읽을 수 없습니다.');

  await writeDocument(settingsPath, created.alice, {
    periodDates: true,
    cyclePhase: true,
    moodTag: true,
    updatedAt: new Date(),
  });
  const sharedProjection = await waitFor(
    '선택 공유 projection',
    () => readDocument(projectionPath, created.bob),
    projection =>
      projection.data?.generatedAt !== privateProjection.data?.generatedAt &&
      projection.data?.cyclePhase === 'luteal' &&
      projection.data?.periodDates?.startDate === '2026-07-10',
  );

  await writeDocument(cyclePath, created.alice, {
    periodDates: {startDate: '2026-07-10'},
    cyclePhase: 'follicular',
    updatedAt: new Date(),
  });
  const cycleProjection = await waitFor(
    'cycle trigger projection',
    () => readDocument(projectionPath, created.bob),
    projection =>
      projection.data?.generatedAt !== sharedProjection.data?.generatedAt &&
      projection.data?.cyclePhase === 'follicular',
  );

  await writeDocument(dailyPath, created.alice, {
    moodTag: 'steady',
    updatedAt: new Date(),
  });
  const deniedDailyRead = await readDocument(dailyPath, created.bob, [403]);
  assert(deniedDailyRead.status === 403, '상대의 private daily 읽기가 허용됐습니다.');
  const dailyProjection = await waitFor(
    'daily trigger projection',
    () => readDocument(projectionPath, created.bob),
    projection =>
      projection.data?.generatedAt !== cycleProjection.data?.generatedAt &&
      projection.data?.moodTag === 'steady',
  );

  await writeDocument(settingsPath, created.alice, {
    periodDates: false,
    cyclePhase: false,
    moodTag: false,
    updatedAt: new Date(),
  });
  await waitFor(
    '공유 회수 projection',
    () => readDocument(projectionPath, created.bob),
    projection =>
      projection.data?.generatedAt !== dailyProjection.data?.generatedAt &&
      !Object.hasOwn(projection.data, 'periodDates') &&
      !Object.hasOwn(projection.data, 'cyclePhase') &&
      !Object.hasOwn(projection.data, 'moodTag'),
  );

  const revoked = await callFunction('revokePair', created.alice, {
    pairId: created.pairId,
  });
  assert(revoked.alreadyRevoked === false, 'Pair가 새로 해제되지 않았습니다.');
  created.revoked = true;

  const deniedProjection = await readDocument(
    projectionPath,
    created.bob,
    [403],
  );
  assert(deniedProjection.status === 403, '해제 후 projection 접근이 허용됐습니다.');

  const adminPair = await readDocumentAsAdmin(pairPath);
  assert(adminPair.data?.status === 'revoked', 'Admin 기준 Pair가 revoked가 아닙니다.');
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
    created.alice,
  );
  const bobMembership = await readDocument(
    `users/${created.bob.uid}/pairMemberships/${created.pairId}`,
    created.bob,
  );
  assert(
    aliceMembership.data?.status === 'revoked' &&
      bobMembership.data?.status === 'revoked',
    'revoke 후 membership mirror가 revoked가 아닙니다.',
  );

  const deniedPrivateAfterRevoke = await readDocument(
    cyclePath,
    created.bob,
    [403],
  );
  assert(
    deniedPrivateAfterRevoke.status === 403,
    'revoke 후 owner-private 접근이 허용됐습니다.',
  );

  const aliceTombstonePath =
    `users/${created.alice.uid}/cacheTombstones/${created.pairId}`;
  const bobTombstonePath =
    `users/${created.bob.uid}/cacheTombstones/${created.pairId}`;
  const aliceTombstone = await readDocument(aliceTombstonePath, created.alice);
  const bobTombstone = await readDocument(bobTombstonePath, created.bob);
  assert(
    aliceTombstone.data?.status === 'pending' &&
      bobTombstone.data?.status === 'pending',
    '양쪽 pending tombstone이 없습니다.',
  );
  await callFunction('acknowledgeCacheTombstone', created.alice, {
    tombstoneId: created.pairId,
  });
  await callFunction('acknowledgeCacheTombstone', created.bob, {
    tombstoneId: created.pairId,
  });
  const acknowledgedAlice = await readDocument(
    aliceTombstonePath,
    created.alice,
  );
  const acknowledgedBob = await readDocument(bobTombstonePath, created.bob);
  assert(
    acknowledgedAlice.data?.status === 'acknowledged' &&
      acknowledgedBob.data?.status === 'acknowledged',
    '양쪽 tombstone acknowledgement가 저장되지 않았습니다.',
  );

  const repeatedRevoke = await callFunction('revokePair', created.bob, {
    pairId: created.pairId,
  });
  assert(repeatedRevoke.alreadyRevoked === true, 'revoke가 멱등하지 않습니다.');

  smokePassed = true;
  console.log('PASS: 익명 계정 2개 초대·수락·기본 비공개·선택 공유·회수·해제');
  console.log('PASS: cycle·daily·shareSettings projection trigger 수렴');
  console.log('PASS: owner-private 접근 차단과 cache tombstone acknowledgement');
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
      `live smoke 실패: ${smokeError.message}; ${cleanupError.message}`,
    );
  }
  throw cleanupError;
}

console.log('PASS: live smoke 테스트 계정·문서 정리');
if (smokeError) throw smokeError;
if (!smokePassed) process.exitCode = 1;
