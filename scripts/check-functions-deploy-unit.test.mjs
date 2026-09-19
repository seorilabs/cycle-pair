import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

const MANIFEST = 'firebase/functions/package.json';
const LOCKFILE = 'firebase/functions/package-lock.json';
const REGENERATE = 'npm --prefix firebase/functions install --package-lock-only';

// Cloud Functions 배포는 firebase.json 의 source 디렉터리만 압축해 올린다.
// pnpm 정본인 firebase/pnpm-lock.yaml 은 그 바깥에 있어 빌더까지 가지 않는다.
// 잠금 파일이 없으면 Cloud Build 가 `npm install --package-lock-only` 로 의존성을
// 직접 풀고, 빌더에 묶인 npm 은 vitest 4 계열을 만나면 아래로 죽는다.
//   npm error Cannot read properties of null (reading 'edgesOut')
// 캐시 이미지가 있는 함수는 이 단계를 건너뛰므로 증상은 캐시가 없는 함수
// (신규 함수이거나 캐시가 만료된 함수)에서만 드러난다.

test('functions 배포 단위가 자체 잠금 파일을 가진다', () => {
  const lock = readJson(LOCKFILE);
  assert.ok(
    lock.lockfileVersion >= 3,
    `${LOCKFILE} 의 lockfileVersion 은 3 이상이어야 한다: ${lock.lockfileVersion}`,
  );
});

test('잠금 파일이 firebase.json 의 업로드 범위 안에 있다', () => {
  const config = readJson('firebase.json');
  const functions = Array.isArray(config.functions)
    ? config.functions
    : [config.functions];
  const unit = functions.find(entry => entry?.source === 'firebase/functions');
  assert.ok(unit, 'firebase.json 에 firebase/functions 배포 단위가 있어야 한다');
  for (const pattern of unit.ignore ?? []) {
    assert.doesNotMatch(
      'package-lock.json',
      new RegExp(`^${pattern.replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*')}$`),
      `firebase.json 의 ignore 가 잠금 파일을 배포 단위에서 빼고 있다: ${pattern}`,
    );
  }
});

test('잠금 파일이 package.json 의 의존성 선언과 어긋나지 않는다', () => {
  // npm ci 는 이 둘이 어긋나면 배포 시점에 실패한다. pnpm 은 이 잠금 파일을
  // 갱신하지 않으므로 의존성을 바꿀 때 사람이 같이 갱신해야 한다.
  const manifest = readJson(MANIFEST);
  const root = readJson(LOCKFILE).packages[''];
  for (const field of ['dependencies', 'devDependencies']) {
    assert.deepEqual(
      root[field] ?? {},
      manifest[field] ?? {},
      `${LOCKFILE} 의 ${field} 가 ${MANIFEST} 와 다르다. \`${REGENERATE}\` 로 갱신한다.`,
    );
  }
});

test('package.json 의 overrides 가 잠금 파일에 실제로 반영돼 있다', () => {
  // npm 은 overrides 를 잠금 파일에 기록하지 않는다. 그래서 어긋나도 npm ci 가
  // 잡아주지 못하고, 고정하려던 버전이 조용히 풀린 채 배포된다.
  const manifest = readJson(MANIFEST);
  const packages = readJson(LOCKFILE).packages;
  for (const [name, pinned] of Object.entries(manifest.overrides ?? {})) {
    const resolved = Object.entries(packages).filter(
      ([location]) => location.endsWith(`node_modules/${name}`),
    );
    assert.ok(
      resolved.length > 0,
      `${name} 이 잠금 파일에 없다. overrides 가 죽은 선언인지 확인한다.`,
    );
    for (const [location, entry] of resolved) {
      assert.equal(
        entry.version,
        pinned,
        `${location} 이 overrides 고정값과 다르다. \`${REGENERATE}\` 로 갱신한다.`,
      );
    }
  }
});
