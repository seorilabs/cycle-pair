# Cycle Pair Firebase 경계

이 디렉터리는 raw 건강 기록과 파트너 공유 projection을 문서 단위로 분리한다. Firebase 프로젝트는 `seorilabs-cyclepair-prod` 하나만 사용한다. Cloud Functions는 `asia-northeast3`, 기존 Firestore `(default)` 데이터베이스는 변경할 수 없는 `nam5` 멀티 리전에 있다. App Check release provider는 Android Play Integrity, iOS App Attest(DeviceCheck fallback)로 고정되어 있고 운영 provider 설정도 존재하지만, Android Play app-signing SHA-256과 실기기 token을 검증하기 전까지 backend는 monitoring-only로 둔다.

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
  A -->|callable only| F[invite / accept / revoke / event CRUD / account / notifications]
  F --> R[(pair + binding + tombstone transaction)]
  F --> E[/pairs/pairId/events/eventId]
  F --> N[/users/uid/notificationDevices/tokenHash]
  P -->|meaningful shared change| M[neutral FCM to active partner]
  E -->|new mutation only| M
  A -->|callable + store evidence| V[server subscription verification]
  V --> G[Google subscriptionsv2]
  V --> I[Apple JWS + Server API]
  G --> U[/subscriptions/uid]
  I --> U
```

## 데이터 경계

- `/users/{uid}/privateCycles/{recordId}`: owner만 읽기/쓰기
- `/users/{uid}/privateDailyLogs/{logId}`: owner만 읽기·추가·수정·삭제
- `/users/{uid}/shareSettings/{pairId}`: 해당 사용자의 Pair-scoped 공유 동의, owner만 읽기/쓰기
- `/pairs/{pairId}`: 정확히 2명의 대칭형 멤버, active 멤버만 읽기, 클라이언트 쓰기 금지
- `/pairs/{pairId}/projections/{ownerUid}`: active Pair 멤버만 읽기, Admin SDK만 쓰기
- `/pairs/{pairId}/events/{eventId}`: active Pair 멤버만 읽기, callable만 생성·수정·삭제
- `/pairs/{pairId}/eventMutations/{mutationId}`: 일정 mutation 멱등성 receipt, 서버 전용
- `/users/{uid}/pairMemberships/{pairId}`: 본인만 읽는 서버 관리 mirror
- `/users/{uid}/cacheTombstones/{pairId}`: 본인만 읽는 오프라인 캐시 삭제 inbox
- `/users/{uid}/notificationDevices/{sha256(token)}`: callable만 관리하는 FCM token·platform·locale·quiet hours, 모든 클라이언트 읽기/쓰기 금지
- `pairInvites`, `pairBindings`, `connectionStates`, `pairTombstones`: 서버 전용
- `accountDeletionStates/{uid}`: 계정 삭제가 시작된 UID의 모든 쓰기와 새 Pair 연결을 차단하고 부분 실패 재시도를 가능하게 하는 서버 전용 상태. 삭제 준비 중에만 256-bit 복구 receipt 원문을 보관해 응답 유실 시 같은 Auth 사용자가 다시 받을 수 있게 하고, 삭제 시작 후에는 SHA-256 hash만 남긴다. Auth 삭제 뒤에도 완료 tombstone과 hash를 영구 유지해 만료 전 ID token의 데이터 재생성을 막고 receipt 소유 기기의 완료 조회를 허용한다.
- `accountExportTickets/{sha256(token)}`: 5분 만료·단회 내보내기 token의 hash·owner·expiry 메타데이터만 저장, 모든 클라이언트 접근 금지
- `accountExportStates/{uid}`: 사용자당 최신 내보내기 ticket 하나만 유지하고 재발급·계정 삭제 시 이전 ticket을 폐기하는 서버 전용 pointer
- `subscriptions/{uid}`: Google/Apple 서버 검증 결과를 정규화한 본인 읽기·서버 쓰기 전용 snapshot
- `purchaseStates/{uid}`: Apple `appAccountToken`과 Google `obfuscatedExternalAccountId`에 공통으로 쓰는 안정적 UUID, 본인 읽기·서버 쓰기 전용
- `purchaseTokens/{sha256(provider:stablePurchaseId)}`: raw receipt/token 없이 cross-UID replay를 차단하는 binding, 해당 owner만 읽기·서버 쓰기 전용
- `notificationTokens/{uid}`: 이전 schema에서 남았을 수 있는 token 문서를 계정 삭제 인벤토리가 함께 제거하는 legacy compatibility cleanup 경로. 신규 등록·갱신은 하지 않으며 현재 source of truth는 `/users/{uid}/notificationDevices/{sha256(token)}`

Firestore 경로는 collection/document가 교차해야 하므로 기획서의 `/privateCycles`, `/privateDailyLogs` 표기는 실제 구현에서 마지막 record ID가 붙는 subcollection으로 해석한다.

Cycle projection은 고정 source of truth인 `privateCycles/current`를 읽는다. Daily-log projection은 문서 ID와 데이터에 함께 저장하는 `YYYY-MM-DD` `localDate` 역순으로 최신 기록을 선택한다. `updatedAt`은 감사·동기화용이며, 과거 기록을 나중에 수정해도 최신 날짜의 projection을 덮지 않는다.

Projection의 `generatedAt`은 서버가 projection 문서를 다시 materialize한 시각일 뿐 원본 건강 기록 시각이 아니다. 공유된 daily 필드에는 `dailyLogDate`, cycle 파생 필드에는 `cycleAsOfDate`를 함께 저장한다. 모바일은 이 source LocalDate가 기기 기준 오늘과 일치하지 않는 daily 상태·cycle phase·예상 범위를 오늘 정보나 케어 추천에 사용하지 않는다. 명시적인 과거 `periodDates`만 날짜 자체가 의미를 설명하므로 유지한다.

Owner client가 쓰는 `privateCycles/current`와 `privateDailyLogs/{localDate}`는 allowlist schema, 실제 Gregorian LocalDate, 길이·enum·수치 범위, server timestamp를 Rules에서 검증한다. 기록 LocalDate는 UTC+14를 고려해 서버 수신 시각보다 최대 하루 앞선 값까지만 허용한다. `recordsCycle`은 owner-private setup을 기준으로 active Pair와 membership mirror에 Functions가 다시 동기화한다.

일일 기록 삭제는 owner와 계정 삭제 barrier를 다시 확인한 뒤 허용한다. 모바일은 삭제를 기기 한정 암호화 캐시와 오프라인 mutation queue에 먼저 반영하고, 온라인 복구 시 서버 문서를 삭제한다. 삭제 trigger는 남아 있는 가장 최근 기록으로 partner projection을 다시 만들며, 다른 기기는 다음 authoritative 목록 조회에서 삭제된 캐시 항목을 제거한다.

## 공유 projection 계약

건강 필드는 기본적으로 모두 비공개다. 현재 active Pair 전용 `/users/{uid}/shareSettings/{pairId}` 문서에서 `<key> === true`인 경우에만 다음 allowlist가 projection에 들어간다.

- Cycle record: `periodDates`, `cyclePhase`, `nextPeriodWindow`
- Daily log: `symptomTags`, `emotionTags`, `energyLevel`, `conditionCode`, `carePreferences`, `note`

OFF/누락/유효하지 않은 값은 `null`로 남기지 않고 문서에서 제거한다. `energyLevel`은 1~5 정수, `conditionCode`는 고정 allowlist, `note`는 500자 이하일 때만 별도 동의에 따라 공유한다. raw 생리일 목록과 allowlist 밖의 값은 projection helper가 복사하지 않는다. Analytics에는 raw 값과 `cyclePhase`를 보내지 않는다.

`periodDates`는 사용자가 Pair별로 명시 동의한 현재 생리 구간만 `{startDate, endDate?}` 형태로 공유한다. 날짜는 실제 달력에 존재하는 `YYYY-MM-DD` LocalDate여야 하며, 진행 중인 구간은 `endDate`를 생략한다.

새 Pair ID에는 settings 문서가 없으므로 모든 필드가 자동으로 비공개다. 이전 Pair의 raw record에 남은 설정값은 읽지 않으며, revoke 트랜잭션은 해당 Pair settings 문서도 삭제한다.

세부 생리 상태는 `cycleStatus`, 가임 가능 시기는 `fertilityStatus` 설정을 사용해 일반 주기 국면과 분리한다. 키가 없거나 false이면 대응하는 상세 상태를 projection에서 제거하고, true인 현재 Pair에만 전달한다. 정확한 배란일·임신 가능성·피임 판단은 생성하지 않는다.

허용 tag는 소문자 영문/숫자/`_`/`-`로 된 최대 40자 ID이며 한 필드당 최대 12개다. 앱의 정식 tag catalog는 제품 core와 맞춰 **확정 필요**다.

## Callable Functions

| 함수                        | 요청                              | 역할                                                                                                                           |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `createPairInvite`          | `{ recordsCycle: boolean }`       | 32-byte bearer token 생성, SHA-256 hash만 저장                                                                                 |
| `acceptPairInvite`          | `{ inviteToken, recordsCycle }`   | 만료·epoch·active Pair를 확인하고 정확히 2명 Pair를 원자 생성                                                                  |
| `revokePair`                | `{ pairId }`                      | Pair를 먼저 revoked 처리하고 projection 삭제, 양쪽 cache tombstone 생성                                                        |
| `acknowledgeCacheTombstone` | `{ tombstoneId }`                 | 앱이 오프라인 partner cache를 지운 뒤 서버 tombstone을 ack                                                                     |
| `upsertPairEvent`           | `{ pairId, event, mutationId }`   | active 멤버의 공동 일정을 검증 후 생성·수정, 생성 감사 필드 보존                                                               |
| `deletePairEvent`           | `{ pairId, eventId, mutationId }` | active 멤버의 공동 일정을 멱등 삭제                                                                                            |
| `requestAccountDataExport` | `{ uid?: currentUid }` | 최근 재인증 후 5분 만료·단회 HTTPS download ticket을 발급하고 기존 ticket을 폐기 |
| `downloadAccountDataExport` | fragment bootstrap + same-origin bearer POST | ticket을 원자 소비한 뒤 bounded JSON을 메모리에서 생성해 `no-store` attachment로 반환 |
| `cleanupExpiredAccountExportTickets` | 15분 schedule | 만료된 ticket hash metadata와 active pointer를 정리 |
| `cleanupExpiredPairRetentionData` | 매일 03:00 Asia/Seoul schedule | `expiresAt` 후 7일 지난 Pair invite와 `acknowledgedAt` 후 30일 지난 acknowledged cache tombstone을 bounded cleanup |
| `beginAccountDeletion` | `{ uid?: currentUid }` | 최근 재인증을 검증하고 영구 write barrier와 256-bit 복구 receipt를 생성하거나 준비 단계의 동일 receipt를 재발급 |
| `getAccountDeletionStatus` | `{ uid, recoveryReceipt }` | Auth가 이미 사라져도 hash가 일치하는 receipt로 `prepared`·`pending`·`completed` 상태만 조회 |
| `deleteMyAccount`           | `{ uid?: currentUid, recoveryReceipt }` | 준비된 receipt를 검증하고 Pair 접근을 차단한 채 계정 인벤토리를 반복 삭제한 뒤 Firebase Auth 사용자를 마지막에 삭제 |
| `finalizePendingAccountDeletions` | 15분 schedule | lease가 만료된 `in-progress`·`revoking-pairs` 삭제를 최대 5건 재개해 Auth 삭제 후 tombstone 기록 장애도 수렴 |
| `registerNotificationDevice` | `{ token, platform, locale, quietHours }` | FCM token hash 문서에 기기와 quiet hours를 사용자당 최대 10개까지 등록                                            |
| `unregisterNotificationDevice` | `{ token }`                    | 인증 사용자 아래의 해당 FCM token hash 문서를 멱등 삭제                                                          |
| `getPurchaseAccountToken` | `{}` | Apple/Google 구매 흐름에 넣을 동일한 안정적 UUID를 생성 또는 재사용 |
| `verifySubscriptionPurchase` | `{ provider, productId, basePlanId, transactionId, purchaseToken }` | Android purchase token 또는 iOS signed transaction JWS를 서버 검증하고 snapshot 저장 |

사용자당 active Pair는 하나뿐이다. invite accept는 자기초대, 이미 사용/만료된 초대, epoch가 지난 초대, 두 사용자 중 한 명에게 active Pair가 있는 경우를 거절한다. accept/revoke가 `inviteEpoch`를 올리므로 이전 pending invite는 재사용할 수 없다.

현재 코드에 확정한 수명·보존 상수는 다음과 같다.

- Invite TTL: 24시간
- Invite 생성 rate limit: 사용자당 1시간 고정 window에 최대 5회
- Expired Pair invite: `expiresAt` 후 7일 보존
- Acknowledged cache tombstone: `acknowledgedAt` 후 30일 보존
- Functions region: `asia-northeast3`
- Firebase 프로젝트 전략: 앱 전용 단일 프로젝트 `seorilabs-cyclepair-prod`; 로컬 테스트는 Emulator 전용 project ID 사용

보존 cleanup은 매일 실행되며 종류별 최대 200개 후보만 조회하고 20개 이하 transaction을 동시에 처리한다. query snapshot은 삭제 근거로 사용하지 않고 각 문서의 현재 `expiresAt` 또는 `status == acknowledged`와 `acknowledgedAt`을 transaction에서 다시 확인한다. 따라서 만료되지 않은 invite와 pending/unacknowledged tombstone은 삭제하지 않는다. 이 cleanup은 즉시성 보안 경계가 아니다. 초대 accept는 항상 `expiresAt`을 transaction 안에서 검사하고, revoke 접근 차단은 `/pairs/{pairId}.status`를 같은 transaction에서 `revoked`로 변경하는 Rules가 담당한다.

공동 일정은 제목 80자, 메모 500자, 실제 `YYYY-MM-DD` 날짜, 선택적 `HH:mm` 시작·종료 시간을 허용한다. 동일 `mutationId` 재전송은 payload hash가 일치할 때만 성공 처리되며 다른 변경에 재사용할 수 없다. revoke는 Rules로 즉시 접근을 차단한 뒤 `events`와 `eventMutations`를 물리 삭제하고, 이미 revoked인 Pair에 대한 재호출도 cleanup을 다시 시도한다.

## 중립 알림 계약

알림은 active Pair의 상대 기기에만 전송한다. 공유 projection에서 `generatedAt`만 바뀐 경우에는 보내지 않고, 실제 allowlist 공유 필드가 추가·변경·제거된 경우에만 `pair-update`/`home`을 보낸다. 공동 일정은 새로운 idempotency mutation이 실제 적용됐을 때만 `shared-event-update`/`calendar`를 보내므로 같은 `mutationId` 재시도는 재발송하지 않는다.

FCM data payload는 정확히 `schemaVersion`, `type`, `destination` 세 필드뿐이다. 제목은 `사이클 페어`, 본문은 `함께 확인할 업데이트가 있어요.`로 고정하며 이름, 날짜, 건강정보, 일정 내용, UID, Pair ID를 넣지 않는다. 수신 기기 IANA time zone의 quiet hours에는 건너뛰고, 등록 해제된 token은 조회 대상이 아니다. FCM이 invalid/unregistered로 판정한 token 문서는 서버가 삭제한다. raw token과 UID는 로그에 남기지 않는다.

일반 로그아웃은 현재 Auth UID로 `unregisterNotificationDevice`가 성공하고 로컬 FCM token이 삭제될 때까지 Auth sign-out을 진행하지 않는다. unregister 실패 시 로컬 token과 로그인 상태를 보존해 재시도한다. 이후 Analytics·Crashlytics collection을 끄고 shell preference를 삭제하므로 알림·진단 opt-in이 다음 계정으로 상속되지 않는다. Auth sign-out 전 후속 정리가 실패하면 저장해 둔 shell preference를 먼저 복원하고 UID backend를 다시 활성화해 이전 opt-in도 provider 재마운트에서 복구한다. 계정 삭제는 먼저 진단 수집과 shell preference를 끈 뒤 FCM unregister를 시도한다. 이 pre-delete unregister가 실패해도 로컬 token은 폐기하고 삭제를 계속할 수 있는데, `deleteMyAccount`가 `users/{uid}/notificationDevices`를 recursive delete하는 서버 측 최종 보장을 제공하기 때문이다. 진단 비활성화나 shell reset 자체가 실패하면 계정 삭제를 시작하지 않는다.

로컬 검증은 실제 FCM을 호출하지 않는다. 개발 프로젝트 재배포 전 Functions runtime service account의 FCM 발송 권한을 확인하고, iOS 실기기 발송 전 Firebase Console에 APNs 인증 키를 등록해야 한다.

## 구독 검증 계약

구독 판매 feature flag는 계속 `false`다. 아래 식별자는 콘솔 생성 전 후보 allowlist이며 가격·혜택·판매를 활성화하지 않는다.

- Google Play: product `cyclepair_plus`, base plan `monthly` / `yearly`
- App Store: `com.seorilabs.cyclepair.plus.monthly` / `com.seorilabs.cyclepair.plus.yearly`
- Android package / iOS bundle: `com.seorilabs.cyclepair`

클라이언트 구매 callback은 entitlement 근거가 아니다. `verifySubscriptionPurchase`는 인증 token의 UID만 사용하고, 먼저 `getPurchaseAccountToken`이 만든 UUID와 Google `externalAccountIdentifiers.obfuscatedExternalAccountId` 또는 Apple signed transaction의 `appAccountToken`이 정확히 같은지 확인한다. Google은 ADC로 `purchases.subscriptionsv2.get`을 매번 호출한다. Apple은 Apple 공식 Node server library로 기기 signed transaction JWS를 검증한 뒤 App Store Server API `Get All Subscription Statuses` 응답의 transaction/renewal JWS도 다시 검증한다.

검증된 stable purchase ID는 provider와 함께 SHA-256한 문서 ID로만 보관한다. raw Play purchase token, Apple JWS, UID는 로그·응답·Analytics·Firestore에 저장하지 않는다. 같은 binding을 다른 UID가 제시하면 원자적으로 거부한다. 만료, 자발적 취소 후 paid-through, grace period, account hold/billing retry, revoke, refund를 `subscriptions/{uid}`의 authoritative snapshot으로 정규화한다.

Google RTDN 함수 `handleGooglePlaySubscriptionRtdn`은 Pub/Sub topic `cyclepair-google-play-rtdn`을 구독한다. RTDN payload 자체에서 entitlement를 결정하지 않고 반드시 subscriptionsv2를 다시 조회한다. Apple Notifications V2 endpoint는 `handleAppStoreServerNotificationV2`이며, 외부 인증 대신 Apple certificate chain·bundle·environment·내부 transaction/renewal JWS를 검증한다. 두 handler는 provider event timestamp와 고유 ID로 이전/중복 event를 무시한다.

현재 Functions dependency는 공식 최신 stable 확인 시점(2026-07-14) 기준 `googleapis@173.0.0`, `@apple/app-store-server-library@3.1.0`이다.

구현 기준 문서는 [Google subscriptionsv2](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get), [Google RTDN](https://developer.android.com/google/play/billing/rtdn-reference), [Apple App Store Server API](https://developer.apple.com/documentation/appstoreserverapi), [Apple Notifications V2](https://developer.apple.com/documentation/appstoreservernotifications/receiving-app-store-server-notifications), [Apple 공식 Node library](https://github.com/apple/app-store-server-library-node)다.

### 외부 운영 gate

다음 작업은 코드에서 자동 생성하거나 배포하지 않았으며 판매 활성화 전에 콘솔에서 완료해야 한다.

- Play Console에서 후보 product/base plan과 가격을 승인·생성하고 Play Developer API service account 권한을 부여한다.
- Pub/Sub topic을 만들고 Google Play Console RTDN topic으로 등록하며 Google Play service agent publish IAM을 설정한다.
- App Store Connect에서 후보 subscription group/products/가격을 승인·생성하고 Notifications V2 production/sandbox URL을 등록한다.
- App Store Connect In-App Purchase key와 Apple PKI root certificate를 Secret Manager에 저장한다. 아래 5개 secret은 Gen2 function option으로 `verifySubscriptionPurchase`와 `handleAppStoreServerNotificationV2`에만 binding하며, Google RTDN·구매 계정 token·그 밖의 함수에는 주입하지 않는다.
- Sandbox/license tester로 신규 구매, 갱신, 취소, grace, hold/billing retry, revoke/refund와 중복 notification을 검증한다.

Apple adapter가 요구하는 runtime secret/environment 이름은 다음과 같다. 값은 repo, `.env`, 로그에 기록하지 않는다.

- `APPLE_IAP_PRIVATE_KEY_BASE64`: App Store Connect In-App Purchase `.p8` key의 base64
- `APPLE_IAP_KEY_ID`
- `APPLE_IAP_ISSUER_ID`
- `APPLE_APP_ID`: production numeric Apple app ID
- `APPLE_IAP_ROOT_CERTIFICATES_BASE64_JSON`: 신뢰할 Apple root DER certificate base64 문자열 배열 JSON

배포 전에 각 값을 Firebase Secret Manager에 등록한다. CLI에 값을 인자로 전달하지 말고 prompt 또는 표준 입력을 사용한다.

```bash
firebase functions:secrets:set APPLE_IAP_PRIVATE_KEY_BASE64
firebase functions:secrets:set APPLE_IAP_KEY_ID
firebase functions:secrets:set APPLE_IAP_ISSUER_ID
firebase functions:secrets:set APPLE_APP_ID
firebase functions:secrets:set APPLE_IAP_ROOT_CERTIFICATES_BASE64_JSON
```

`APPLE_APP_ID`를 포함한 다섯 값은 동일한 최소 권한 lifecycle로 관리한다. Functions 배포 manifest에서 두 Apple 검증 경계만 이 secret들을 요구하는지 확인한 뒤 배포한다.

Google adapter는 service-account JSON을 앱이나 repo에 두지 않고 Cloud Functions runtime ADC를 사용한다. 자격증명·root certificate·콘솔 product가 없거나 응답이 불완전하면 검증은 fail closed한다.

## 내보내기·계정 삭제 계약

`requestAccountDataExport`는 익명 계정을 거절하고 ID token의 `auth_time`이 호출 시각 기준 5분 이내인 복구 가능한 계정을 요구한다. `beginAccountDeletion`도 복구 가능한 계정에는 같은 최근 재인증을 요구하지만, 재인증 credential이 없는 Firebase 익명 계정은 유효한 익명 Auth token만으로 본인 계정 삭제를 준비할 수 있다. 이미 준비된 삭제 receipt의 재발급은 동일 UID의 유효한 Auth token만 요구한다. `deleteMyAccount`는 동일 UID의 Auth token과 준비 단계에서 발급한 receipt를 모두 검증하므로 장시간 재시도에서 `auth_time`을 다시 요구하지 않는다. 세 인증 함수 모두 요청의 `uid`가 `request.auth.uid`와 정확히 같아야 한다. 다른 사용자의 UID를 지정한 요청은 계정 종류와 관계없이 거절한다.

`getAccountDeletionStatus`는 Firebase Auth 사용자가 이미 삭제된 복구 상황을 위해 Auth를 요구하지 않는다. 대신 추측 불가능한 256-bit receipt의 SHA-256 hash를 timing-safe 비교하고 `prepared`·`pending`·`completed`와 완료 시각 외에는 반환하지 않는다. 운영에서 App Check를 강제하면 이 복구 호출도 등록된 앱 인스턴스에서만 실행된다.

기본 Storage bucket은 사용하지 않는다. callable은 32-byte random token의 SHA-256 hash, owner UID, 생성·만료 시각만 Firestore에 저장하고 `schemaVersion`, `exportSubjectUid`, `expiresAt`, `filename`, `singleUse`, `downloadUrl`만 반환한다. raw token은 URL query가 아닌 fragment에 넣으므로 bootstrap GET·Referer·일반 request URL 로그로 전달되지 않는다. bootstrap은 fragment를 즉시 browser history에서 제거하고 same-origin `Authorization` POST로만 token을 전달한다.

`downloadAccountDataExport`는 hash ticket을 트랜잭션에서 먼저 삭제하는 consume-before-generate 정책을 쓴다. 따라서 동시 요청과 replay 중 하나만 성공하며 생성 실패 시에도 사용한 link는 복구되지 않는다. 성공 응답은 `Content-Type: application/json`, 안전한 고정형 filename의 `Content-Disposition: attachment`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, CSP·nosniff·frame deny를 적용한다. JSON 원문은 Firestore·Storage·로그에 저장하지 않고 응답 메모리에서만 생성한다. ticket은 발급 5분 후 즉시 인증에 실패하며, 만료 metadata는 15분 schedule이 정리한다. 재발급과 계정 삭제도 기존 ticket을 즉시 폐기한다.

다운로드 JSON 최상위에는 `schemaVersion: 1`, ISO 8601 `exportedAt`, `exportSubjectUid`, `limits`, `truncated`, `data`가 있다. Firestore Timestamp 등 custom 값은 JSON-safe 값으로 변환한다. 응답 한도는 private cycle 100건, daily log 1,000건, share settings 100건, membership 100건, active Pair 4개, Pair별 event 500건이다. 각 collection과 최상위 `truncated`가 한도 초과 여부를 명시한다. 한도 초과가 표시된 export를 완전한 사본으로 안내해서는 안 된다.

`deleteMyAccount`는 다음 순서를 보장한다.

1. 클라이언트가 device-only Keychain에 `deletion-preparing` intent를 기록한 뒤 `beginAccountDeletion`이 `accountDeletionStates/{uid}`와 receipt를 생성해 Rules owner write와 모든 mutating callable을 차단한다. receipt가 Keychain의 `deletion-pending` intent에 저장된 뒤에만 실제 삭제를 시작한다.
2. active Pair를 `revoked`로 바꿔 Rules 접근을 즉시 차단하고 projection·공동 일정·mutation receipt를 삭제한다.
3. 상대 membership에서 삭제 사용자 식별자를 제거하고 UID가 없는 cache tombstone을 남긴다.
4. outstanding export ticket/state를 접근 barrier 단계에서 폐기하고, `users/{uid}` 전체와 그 아래 `notificationDevices`, 본인이 생성·수락한 invite, Pair 문서, binding/state, subscription·purchase state 및 UID query로 찾은 전역 purchase-token binding을 recursive inventory로 삭제한다.
5. 남은 Firestore 데이터 삭제 후 Firebase Auth 사용자를 삭제하고, 성공한 경우 `accountDeletionStates/{uid}`를 receipt hash가 포함된 최소 `completed` tombstone으로 갱신한다. 이 barrier는 삭제하지 않으며, 만료 전 ID token으로도 owner write나 mutating callable을 다시 실행할 수 없다.

삭제 작업은 UID별 10분 lease로 중복 worker를 차단한다. 중간 실패나 원래 callable 응답 유실 시 15분 schedule이 `in-progress`·`revoking-pairs` 상태를 재개한다. Auth 삭제 뒤 tombstone 쓰기만 실패한 경우에도 `auth/user-not-found`를 멱등 성공으로 처리해 완료 상태로 수렴한다. 클라이언트는 Auth 없이 receipt로 완료를 확인한 뒤에만 `local-cleanup-pending`으로 전환해 기기 데이터를 지운다. 함수 코드와 테스트는 건강 데이터, 일정 제목·메모, 자유 텍스트를 logger에 전달하지 않는다. Firestore 백업 보존기간·백업 삭제 SLA는 별도 개인정보 정책/운영 gate다.

## App Check

계정 삭제 완료 조회를 제외한 사용자 callable은 Firebase Auth를 필수로 한다. 게스트는 Seorilabs Platform이 생성한 `pb_` UID의 Custom Token으로 로그인한다. 이 게스트는 내보내기를 사용할 수 없지만 본인 계정과 데이터를 영구 삭제할 수 있다. 이메일/password provider가 연결되면 같은 UID의 복구 가능한 계정으로 처리한다. 모바일 entry point는 Firebase 사용 전에 App Check를 초기화하고, 같은 프로젝트에서 Debug는 debug provider, Release는 Play Integrity/App Attest(DeviceCheck fallback)를 사용한다. Callable은 `ENFORCE_APP_CHECK=true`로 배포될 때만 App Check를 강제한다. 2026-08-06 API 재조회 기준 Play Integrity와 App Attest 설정은 존재하고 Firestore·Auth·Storage는 `UNENFORCED` monitoring-only다. Android Firebase app에는 SHA-256 인증서가 아직 없으므로 Play app-signing 인증서와 실제 release token을 확인하기 전에는 강제를 켜지 않는다.

Firestore native persistence는 민감한 partner projection이 일반 OS 캐시에 남지 않도록 모바일 어댑터에서 비활성화한다. 오프라인 데이터는 UID별 Keychain cache/queue에만 저장한다. Pair tombstone을 받으면 해당 Pair cache와 queued mutation을 먼저 지우고 ack한 뒤 남은 UID queue를 즉시 flush한다. 로그아웃·계정 삭제는 UID writer fence를 동기적으로 닫고 진행 중인 Keychain write와 backend mutation을 drain한 뒤 purge하므로 늦은 snapshot이나 flush가 삭제 데이터를 다시 만들 수 없다.

`users/{uid}/privateCycles/current`는 앱 재실행 시 역할·동의·주기 입력을 복원하는 owner-only source of truth다. 정식 동의 계약은 schema v2의 `consentVersion=2026-08-09-v1`이며, 기존 schema v1 자료는 읽기·내보내기를 위해 보존하지만 재동의 전 신규 건강정보 쓰기와 partner projection에는 사용하지 않는다. 주기를 기록하지 않는 역할도 같은 문서에 역할·동의만 저장하며 건강 날짜를 만들지 않는다. Pair별 공유 설정은 `shareSettings/{pairId}` 문서 존재 여부까지 포함해 서버에서 복원하며, 새 Pair에는 이전 Pair 설정을 승계하지 않는다.

## 로컬 검증

Node.js 22와 Java가 필요하다.

```bash
pnpm --dir firebase install --frozen-lockfile
pnpm --dir firebase check
```

`test:rules`는 실제 프로젝트 대신 Firebase Emulator 전용 `demo-cyclepair` project ID를 사용한다. `.firebaserc`의 유일한 실제 project는 `seorilabs-cyclepair-prod`다.

## 단일 프로젝트 배포·실검증

`seorilabs-cyclepair-dev`의 2026-07-13 audit은 과거 참고 기록일 뿐 현재 배포 근거로 사용하지 않는다. 현재 source는 `seorilabs-cyclepair-prod`에 배포하고 같은 프로젝트에서 live smoke를 수행한다. `seorilabs-cyclepair-dev`와 `seorilabs-moonmate-dev`는 데이터 이전 없이 2026-08-06 프로젝트 삭제를 요청했고 둘 다 `DELETE_REQUESTED`로 확인했다. 복구하지 않으며 기본 compute 서비스 계정은 다음 최소 역할을 사용한다.

- `roles/cloudbuild.builds.builder`: Functions build
- `roles/datastore.user`: Functions runtime의 Firestore read/write
- `roles/eventarc.eventReceiver`: Firestore event 수신
- `roles/run.invoker`: Eventarc가 Cloud Run target 호출
- Pub/Sub service agent의 `roles/iam.serviceAccountTokenCreator`

Seorilabs 조직은 Domain Restricted Sharing으로 `allUsers` IAM binding을 거부한다. 따라서 callable Functions는 Cloud Run Invoker IAM check를 비활성화한다. 이는 callable 내부 Firebase Auth를 끄는 설정이 아니다. 요청은 Cloud Run에 진입한 뒤 `request.auth`가 없으면 `UNAUTHENTICATED`로 거부되고, 운영 전에는 App Check도 별도 강제한다.

Functions 재배포 후 다음 상태를 반드시 재확인한다.

```bash
for service in createpairinvite acceptpairinvite revokepair acknowledgecachetombstone upsertpairevent deletepairevent requestaccountdataexport downloadaccountdataexport beginaccountdeletion getaccountdeletionstatus deletemyaccount registernotificationdevice unregisternotificationdevice getpurchaseaccounttoken verifysubscriptionpurchase handleappstoreservernotificationv2; do
  gcloud run services update "$service" \
    --project=seorilabs-cyclepair-prod \
    --region=asia-northeast3 \
    --no-invoker-iam-check
done

gcloud functions list --v2 \
  --project=seorilabs-cyclepair-prod \
  --regions=asia-northeast3
```

현재 source 전체와 배포 fingerprint가 같은지는 아직 새 배포 evidence로 검증하지 않았다. 다만 2026-08-06 운영 live smoke에서 현재 Rules 문서 계약으로 Platform Custom Token, callable, 3종 projection trigger, owner-private deny, revoke·tombstone ack와 cleanup을 통과했고, 누락된 runtime `roles/datastore.user` 보정 뒤 예약 함수 3종도 모두 HTTP 200으로 확인했다. 배포 승인 전에는 나머지 HTTPS export 경계, legacy `exportMyData` 제거, FCM/APNs, 구독과 정확한 deployment source fingerprint를 계속 별도 gate로 둔다.

실제 smoke는 prod project ID와 명시적 opt-in을 강제하며 UID, ID token, Custom Token, 초대 token을 출력하지 않는다. 플랫폼 Custom Token 발급과 Firebase 교환을 포함하고 성공과 실패 모두 생성한 플랫폼 사용자·Firebase 사용자·문서를 정리한다.

```bash
CYCLEPAIR_ALLOW_PRODUCTION_SMOKE=true \
CYCLEPAIR_FIREBASE_WEB_API_KEY="$(jq -r '.client[0].api_key[0].current_key' \
  apps/mobile/android/app/src/main/google-services.json)" \
CYCLEPAIR_ADMIN_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
pnpm test:firebase:live
```

`release-readiness.json` schema v4는 실제 클라우드 gate의 repo-local evidence inventory다. 과거 배포는 이후 배포 입력이 변경됐으므로 `stale`로 기록하며 현재 배포로 간주하지 않는다. `check:release`의 `sha256-deployment-source-v3`는 다음 실제 배포 입력을 결정적으로 fingerprint하고 단일 deployment evidence에 바인딩한다.

- root `firebase.json` 중 canonical `firestore`·`functions` 설정. Emulator port/UI와 RN client default는 배포 입력에서 제외
- `firebase/firestore.rules`
- `firebase/firestore.indexes.json`
- `firebase/functions/src` 전체와 Functions `package.json`, `tsconfig.json`, 존재하는 package-manager config
- 실제 `pnpm --dir firebase` workspace source of truth인 `firebase/package.json`, `firebase/pnpm-lock.yaml`, `firebase/pnpm-workspace.yaml`

위 배포 source가 한 바이트라도 달라지면 이전 `verified` evidence도 blocker가 된다. root mobile importer만 포함하는 lock/workspace 변경과 emulator-only 설정 변경은 Functions 배포를 stale 처리하지 않는다. deployment `gitSha`는 현재 repo에 실제 존재하는 HEAD ancestor commit이어야 하고, 해당 commit의 deploy source 및 canonical Firebase config가 현재 source와 같아야 한다. release ready가 되려면 manifest와 `.firebaserc`, Android/iOS 단일 native config, 앱 등록 evidence와 현재 fingerprint에 대응하는 deployment evidence가 모두 `seorilabs-cyclepair-prod`에 결합돼야 한다.

실제 배포와 필요한 live smoke를 끝낸 경우에만 deployment의 `status`, `verifiedAt`, `evidence`, project ID, region, 40자리 Git SHA, RFC 3339 `deployedAt`, source hash를 함께 갱신한다. IAM·Auth·App Check 항목도 콘솔 또는 CLI 확인 근거와 시각 없이 `verified`로 바꾸지 않는다. billing/runtime IAM/callable invoker/Pair smoke, Android FCM·iOS APNs 실제 수신, Google Play Developer API·RTDN, Apple secrets·Notifications V2, export HTTPS invoker·cleanup scheduler·legacy `exportMyData` 제거 evidence는 단일 project ID에 결합해야 한다. App Check evidence는 문자열 메모만으로 통과하지 않으며 project ID, Android/iOS provider, Firestore·Callable Functions 각각의 enforcement boolean을 함께 기록해야 한다. checker는 RNFirebase dependency, startup gate, 빌드별 provider source, iOS native factory/capability와 Functions enforcement source도 별도로 검사한다. 현재 fingerprint는 `pnpm check:release` 출력의 `sourceFingerprints.firebase`에서 확인할 수 있지만, checker는 배포 evidence를 자동 승인하거나 파일에 기록하지 않는다.
