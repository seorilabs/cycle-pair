# 실제 RN 화면의 개발 실행

승인 설계 v3의 작성자 확인과 독립 검수에 쓰는 개발 도구다. `App.tsx`, 화면, Store, 계정 어댑터와 Firebase 백엔드 원본을 직접 import한다. 별도 HTML 제품 화면을 만들지 않는다. 이 폴더의 의존성은 네이티브 앱에 포함하지 않는다.

```sh
npm ci --ignore-scripts --no-audit --no-fund --workspaces=false --prefix scripts/dev-rn-web
pnpm --dir firebase/functions build
# Node 22로 실행. 자체 demo emulator와 프록시 포트가 비어 있어야 한다.
node scripts/dev-rn-web/start-emulators.mjs
CYCLEPAIR_CANDIDATE=$(git rev-parse HEAD) node scripts/dev-rn-web/build.mjs
python3 -m http.server 4177 --bind 127.0.0.1 --directory scripts/dev-rn-web/dist
```

브라우저는 `http://127.0.0.1:4177/?run=<검수별값>&actor=owner&lang=ko`로 연다. 다른 사용자 역할은 `actor=partner`를 사용한다. Firebase 프로젝트는 `demo-cyclepair`로 고정하고 Auth 9599, Firestore 8530, Functions 5501을 사용한다. 기존 운영 환경 파일을 읽지 않는다. 함수 빌드는 이 worktree의 원본이어야 한다. Functions의 외부 접속을 차단하며 CLI 프록시는 지정된 loopback 포트만 허용한다. 기존 `.env.local`과 `.secret.local`을 덮어쓰지 않고, 종료 때 직접 만든 설정과 임시 디렉터리만 정리한다. 직접 만든 프로세스만 종료한다.

고정 후보 검수는 깨끗한 제품 소스에서 빌드한다. `--author`는 미커밋 변경의 작성자 미리보기만 허용하며 독립 검수 근거로 쓰지 않는다. `fixture-plan.json`과 `window.__cyclePairQa`에는 실제 HEAD, 제품 파일 내용의 SHA-256과 `authorRun`을 기록한다. 원본 그림은 앱의 `src/assets/brand`에 한 번만 보관하고 PNG 아이콘 파생본은 `npm run icons --prefix scripts/dev-rn-web`로 재생성한다.

## 플랫폼 경계와 조작

- 원본 RN의 `accessibilityState`는 host `Pressable`과 `View`에서 동등한 DOM aria 상태로 전달한다. RNWeb의 상태 변환 누락을 보완하며 제품의 선택 값을 바꾸지 않는다.
- `lang=ko` 또는 `lang=en`은 처음 언어 설정만 정한다. 이후 실제 설정 화면의 언어 선택을 따른다.
- `fontScale=2`는 실제 RN 원본의 `Text`와 `TextInput`에 지정한 글자 크기와 줄 높이를 두 배로 렌더링한다. DPR과 화면 전체 확대를 글자 확대 증거로 쓰지 않는다. 실제 OS 글꼴 설정 검수는 아니다.
- `__cyclePairQa.pressBack()`과 Alt+왼쪽 화살표는 실제 `useHardwareBack`이 등록한 콜백을 역순으로 호출한다. Android OS의 이벤트 전달 증거는 아니다.
- 입력의 focus는 실제 `useKeyboardVisibility`가 등록한 키보드 구독을 통지한다. `emitKeyboard(true/false)`도 같은 경계만 호출한다. 브라우저 크기를 줄여 입력과 완료 행동을 확인할 수 있으나 실제 OS 키보드와 안전 영역 검수는 아니다.
- 날짜 선택은 브라우저의 실제 date input으로 대체한다. 보안 저장소는 검수별 브라우저 저장소로 대체한다. native Keychain과 Android Keystore 보장을 입증하지 않는다.
- 알림은 기본 거부다. `notification=authorized`는 가상 권한과 토큰으로 실제 `createNotificationClient`와 demo 서버 등록, 해제를 실행한다. `openNotification(payload)`와 `refreshNotificationToken(token)`은 등록된 경계 콜백을 호출한다. 실제 APNs, FCM과 OS 권한 검수는 아니다.
- `failNext(operation)`은 다음 개발 백엔드 호출만 실패시킨다. `holdNext(operation)` 뒤 `heldOperations`에서 도달을 확인하고 `releaseHeld(operation, false)`로 실제 저장을 이어가거나 `true`로 실패시킨다. 화면과 Store 원본은 바꾸지 않는다. 지원 호출은 `saveDailyLogChange`, `saveDailyLog`, `savePrivateSetup`, `saveShareSettings`, `loadPrivateSetup`, `syncDailyLogs`, `upsertPairEvent`, `deleteDailyLog`다. 현재 날짜별 기록과 생리 표시 저장은 `saveDailyLogChange`를 지정한다. 기존 시나리오의 `saveDailyLog`도 이 이름으로 바꾸며, 두 호출을 자동으로 치환하지 않는다.
- 이 실패는 어댑터 호출 전의 개발 경계다. Store의 대기, 뒤로 이동 차단, 초안과 재시도를 확인하며, 어댑터 내부 트랜잭션과 오프라인 큐 저장을 실행한 근거로 쓰지 않는다. 정상 해제는 원래 `saveDailyLogChange`를 인자 변경 없이 한 번 호출한다.
- `holdSyncDailyLogs=1`은 앱을 처음 렌더링하기 전에 다음 기록 조회를 보류한다. 기존 가상 계정의 캐시가 있는 재실행과 빈 캐시의 지연 복구를 확인할 때 사용하고 같은 `releaseHeld`로 해제한다. 운영 빌드에는 포함하지 않는다.
- `readOwnDaily()`는 demo Firestore의 현재 사용자 오늘 기록을 서버에서 직접 읽는다. 분석과 오류 수집 경계의 `calls`에는 기능 이벤트와 고정 범주만 기록하고 기록 내용과 비밀번호를 넣지 않는다.

새 테스트 자료는 각 검수의 고유 run과 actor에만 만든다. 계정과 합성 기록은 demo emulator 안에 있으며 운영 계정과 자료를 사용하지 않는다. 검수 원본은 작업별 산출물 경로로 모으고 NAS 복사와 해시 확인 뒤 정리한다. 독립 L3와 세 번의 기능, UX 검수는 구현자와 다른 검수자가 후보를 고정하고 사전 계획을 기록한 뒤 수행한다.

도구의 지연과 실패 경계는 `node --test scripts/dev-rn-web/faultable-boundary.test.mjs`로 확인한다. 이 검사는 `build.mjs`의 실제 proxy 코드를 추출해 가짜 백엔드만 호출하며 앱, Firebase, 브라우저와 기기를 실행하지 않는다. 정식 화면 검수나 제품 트랜잭션 검사를 대신하지 않는다.
