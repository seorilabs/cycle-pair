# MoonMate Firebase 경계

이 디렉터리는 raw 건강 기록과 파트너 공유 projection을 문서 단위로 분리한다. 개발 프로젝트는 `seorilabs-moonmate-dev`, Firestore·Functions 리전은 `asia-northeast3`다. App Check 운영 정책은 아직 **확정 필요**다.

```mermaid
flowchart LR
  A[owner client] -->|owner-only write| C[/users/uid/privateCycles/recordId]
  A -->|owner-only write| D[/users/uid/privateDailyLogs/logId]
  A -->|Pair-scoped consent| S[/users/uid/shareSettings/pairId]
  C --> T[Firestore trigger]
  D --> T
  S --> T
  T -->|allowlist + active Pair settings| P[/pairs/pairId/projections/ownerUid]
  P -->|active pair members read| B[partner client]
  A -->|callable only| F[invite / accept / revoke]
  F --> R[(pair + binding + tombstone transaction)]
```

## 데이터 경계

- `/users/{uid}/privateCycles/{recordId}`: owner만 읽기/쓰기
- `/users/{uid}/privateDailyLogs/{logId}`: owner만 읽기/쓰기
- `/users/{uid}/shareSettings/{pairId}`: 해당 사용자의 Pair-scoped 공유 동의, owner만 읽기/쓰기
- `/pairs/{pairId}`: 정확히 2명의 대칭형 멤버, active 멤버만 읽기, 클라이언트 쓰기 금지
- `/pairs/{pairId}/projections/{ownerUid}`: active Pair 멤버만 읽기, Admin SDK만 쓰기
- `/users/{uid}/pairMemberships/{pairId}`: 본인만 읽는 서버 관리 mirror
- `/users/{uid}/cacheTombstones/{pairId}`: 본인만 읽는 오프라인 캐시 삭제 inbox
- `pairInvites`, `pairBindings`, `connectionStates`, `pairTombstones`: 서버 전용

Firestore 경로는 collection/document가 교차해야 하므로 기획서의 `/privateCycles`, `/privateDailyLogs` 표기는 실제 구현에서 마지막 record ID가 붙는 subcollection으로 해석한다.

Private record는 projection 최신값 계산을 위해 `updatedAt: Timestamp`를 가져야 한다. `updatedAt`이 없는 문서는 기록 자체는 허용되지만 projection 후보에서는 제외된다.

## 공유 projection 계약

건강 필드는 기본적으로 모두 비공개다. 현재 active Pair 전용 `/users/{uid}/shareSettings/{pairId}` 문서에서 `<key> === true`인 경우에만 다음 allowlist가 projection에 들어간다.

- Cycle record: `periodDates`, `cyclePhase`, `nextPeriodWindow`, `pmsWindow`
- Daily log: `symptomTags`, `moodTag`, `carePreferences`

OFF/누락/유효하지 않은 값은 `null`로 남기지 않고 문서에서 제거한다. raw 생리일 목록, 원문 증상·mood, 메모 등 allowlist 밖의 값은 projection helper가 복사하지 않는다. Analytics에는 raw 값과 `cyclePhase`를 보내지 않는다.

`periodDates`는 사용자가 Pair별로 명시 동의한 현재 생리 구간만 `{startDate, endDate?}` 형태로 공유한다. 날짜는 실제 달력에 존재하는 `YYYY-MM-DD` LocalDate여야 하며, 진행 중인 구간은 `endDate`를 생략한다.

새 Pair ID에는 settings 문서가 없으므로 모든 필드가 자동으로 비공개다. 이전 Pair의 raw record에 남은 설정값은 읽지 않으며, revoke 트랜잭션은 해당 Pair settings 문서도 삭제한다.

가임기·배란·피임 추론은 승인 범위에서 제외됐다. 따라서 product core의 `ovulatory` 및 유사 값은 공유 설정이 켜져 있어도 projection에서 제거한다.

허용 tag는 소문자 영문/숫자/`_`/`-`로 된 최대 40자 ID이며 한 필드당 최대 12개다. 앱의 정식 tag catalog는 제품 core와 맞춰 **확정 필요**다.

## Callable Functions

| 함수 | 요청 | 역할 |
|---|---|---|
| `createPairInvite` | `{ recordsCycle: boolean }` | 32-byte bearer token 생성, SHA-256 hash만 저장 |
| `acceptPairInvite` | `{ inviteToken, recordsCycle }` | 만료·epoch·active Pair를 확인하고 정확히 2명 Pair를 원자 생성 |
| `revokePair` | `{ pairId }` | Pair를 먼저 revoked 처리하고 projection 삭제, 양쪽 cache tombstone 생성 |
| `acknowledgeCacheTombstone` | `{ tombstoneId }` | 앱이 오프라인 partner cache를 지운 뒤 서버 tombstone을 ack |

사용자당 active Pair는 하나뿐이다. invite accept는 자기초대, 이미 사용/만료된 초대, epoch가 지난 초대, 두 사용자 중 한 명에게 active Pair가 있는 경우를 거절한다. accept/revoke가 `inviteEpoch`를 올리므로 이전 pending invite는 재사용할 수 없다.

현재 코드 상수는 다음과 같으며 제품·운영 정책 승인이 **확정 필요**다.

- Invite TTL: 24시간
- Invite 생성 rate limit: 사용자당 1시간 고정 window에 최대 5회
- Tombstone 보존기간 및 삭제 작업: 확정 필요
- Expired invite 보존기간/Firestore TTL policy: 확정 필요
- Functions region: `asia-northeast3`
- Firebase 프로젝트 전략: 민감 건강정보·Auth·Rules·운영 격리를 위한 앱별 개발 프로젝트 `seorilabs-moonmate-dev`

TTL 삭제는 즉시성 보안 경계가 아니다. 초대 accept는 항상 `expiresAt`을 트랜잭션 안에서 검사한다. revoke 접근 차단은 `/pairs/{pairId}.status`를 같은 트랜잭션에서 `revoked`로 변경하는 Security Rules 경계가 담당한다.

## App Check

Callable은 Firebase Auth를 필수로 한다. 현재 Android/iOS 개발 앱은 실제 2인 흐름 검증용 익명 인증을 사용하며 운영 로그인 정책은 아니다. `ENFORCE_APP_CHECK=true`일 때 App Check도 강제한다. Android/iOS와 AppsInToss 런타임에서 App Check 경로를 실제 검증하기 전에는 기본값이 false이므로, 운영 배포 전 정책 확정 및 활성화가 release blocker다.

Firestore native persistence는 민감한 partner projection이 일반 OS 캐시에 남지 않도록 모바일 어댑터에서 비활성화한다. 암호화된 로컬 캐시와 회수 정책이 구현되기 전에는 서버 tombstone을 수신해 메모리 상태를 지우고 ack하는 범위만 지원한다.

`users/{uid}/privateCycles/current`는 앱 재실행 시 역할·동의·주기 입력을 복원하는 owner-only source of truth다. 주기를 기록하지 않는 역할도 같은 문서에 역할·동의만 저장하며 건강 날짜를 만들지 않는다. Pair별 공유 설정은 `shareSettings/{pairId}` 문서 존재 여부까지 포함해 서버에서 복원하며, 새 Pair에는 이전 Pair 설정을 승계하지 않는다.

## 로컬 검증

Node.js 22와 Java가 필요하다.

```bash
pnpm --dir firebase install --frozen-lockfile
pnpm --dir firebase check
```

`test:rules`는 실제 프로젝트 대신 Firebase Emulator 전용 `demo-moonmate` project ID를 사용한다. `.firebaserc`는 개발 프로젝트를 가리키며 운영 프로젝트 alias는 출시 준비 때 별도 추가한다.

## 개발 프로젝트 배포·실검증

`seorilabs-moonmate-dev`는 결제 연결, Node.js 22 2nd Gen Functions 7개, Firestore trigger 3개가 `asia-northeast3`에 배포돼 있다. 신규 프로젝트의 기본 compute 서비스 계정은 다음 최소 역할을 사용한다.

- `roles/cloudbuild.builds.builder`: Functions build
- `roles/datastore.user`: Functions runtime의 Firestore read/write
- `roles/eventarc.eventReceiver`: Firestore event 수신
- `roles/run.invoker`: Eventarc가 Cloud Run target 호출
- Pub/Sub service agent의 `roles/iam.serviceAccountTokenCreator`

Seorilabs 조직은 Domain Restricted Sharing으로 `allUsers` IAM binding을 거부한다. 따라서 callable 4개는 Cloud Run Invoker IAM check를 비활성화한다. 이는 callable 내부 Firebase Auth를 끄는 설정이 아니다. 요청은 Cloud Run에 진입한 뒤 `request.auth`가 없으면 `UNAUTHENTICATED`로 거부되고, 운영 전에는 App Check도 별도 강제한다.

Functions 재배포 후 다음 상태를 반드시 재확인한다.

```bash
for service in createpairinvite acceptpairinvite revokepair acknowledgecachetombstone; do
  gcloud run services update "$service" \
    --project=seorilabs-moonmate-dev \
    --region=asia-northeast3 \
    --no-invoker-iam-check
done

gcloud functions list --v2 \
  --project=seorilabs-moonmate-dev \
  --regions=asia-northeast3
```

실제 개발 프로젝트 smoke는 dev project ID를 강제하며 UID, ID token, 초대 token을 출력하지 않는다. 성공과 실패 모두 생성한 문서·익명 계정을 정리한다.

```bash
MOONMATE_FIREBASE_PROJECT=seorilabs-moonmate-dev \
MOONMATE_FIREBASE_WEB_API_KEY="$(jq -r '.client[0].api_key[0].current_key' \
  apps/mobile/android/app/google-services.json)" \
MOONMATE_ADMIN_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
pnpm test:firebase:live
```

`release-readiness.json`은 실제 클라우드 gate의 repo-local inventory다. 결제 연결, Functions 배포, 운영 Auth, App Check가 실제로 확인된 뒤에만 해당 값을 `true`로 변경한다.
