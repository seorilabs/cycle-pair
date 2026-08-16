# Cycle Pair 아키텍처

## 목표

- 제품 core를 React Native, Firebase, 스토어 SDK에서 분리한다.
- owner-private 원본과 partner projection을 물리적으로 분리한다.
- 정확히 두 명인 Pair와 단일 공유 상대 제약을 서버에서 강제한다.
- 민감정보가 로그, Analytics, 알림, 캐시에 새지 않게 한다.
- Google Play·App Store 전체 앱과 AppsInToss의 최소 데이터 공유 slice를 독립 composition으로 유지한다.

## 레이어

~~~mermaid
flowchart LR
  UI["apps mobile"] --> APP["application composition"]
  APP --> CORE["packages product core"]
  APP --> ADAPTERS["Firebase and native adapters"]
  ADAPTERS --> FB["Firebase"]
  ADAPTERS --> STORE["StoreKit and Play Billing"]
  AIT["apps ait condition share"] --> CORE
  AIT -. policy-gated adapter .-> FB
~~~

product-core에는 domain entity, value object, pure use case, port, pure test fixture만 둔다. React Native, Firebase, AppsInToss, Apple, Google, 광고, Analytics SDK를 import하면 안 된다.

## repo 경계

| 경로 | 책임 |
| --- | --- |
| packages/product-core | LocalDate, Pair, 기록, 예측, 공유 필터, 케어 매칭, entitlement |
| apps/mobile | Android/iOS UI, navigation, lifecycle, native 권한 |
| firebase | Rules, indexes, Functions, emulator 테스트 |
| play-store | Google Play 등록 source of truth |
| app-store | App Store 등록 source of truth |
| apps-in-toss | 정책 검토와 조건부 등록 source of truth |
| apps/ait | SDK 2.x RN 0.84 + TDS, 로컬 컨디션 선택과 명시적 공유 |

`apps/mobile/src/platform/firebase`는 `@react-native-firebase` Auth·Firestore·Functions를 앱 전용 backend port 뒤에 둔다. 개발 단계에서는 익명 인증으로 2인 흐름을 검증하며, 운영 로그인 제공자가 확정되면 같은 port 뒤에서 계정 업그레이드 경로를 교체한다. 민감한 partner projection이 OS 수준 일반 캐시에 남지 않도록 Firestore native persistence는 현재 비활성화한다.

AsyncStorage에는 온보딩 완료 여부와 중립 알림 선호만 저장한다. 역할, 동의 시각, 주기 시드, 일일 기록, Pair별 공유 동의와 partner projection은 로컬 평문 persistence 대상이 아니며 owner-private Firestore에서 복원한다.

## 시스템 흐름

~~~mermaid
sequenceDiagram
  participant O as Owner app
  participant P as Private Firestore
  participant F as Cloud Function
  participant S as Pair projection
  participant M as Partner app
  O->>P: owner-private 기록 저장
  O->>P: 공유 설정 변경
  P-->>F: projection 갱신 트리거
  F->>F: active Pair와 동의 필드 검증
  F->>S: 허용된 키만 materialize
  M->>S: active Pair projection 조회
  Note over M,S: private 원본 경로 접근 불가
~~~

## Firestore 논리 모델

| 경로 | 읽기 | 쓰기 | 내용 |
| --- | --- | --- | --- |
| users/{uid}/privateCycles/current | 본인 | 본인 | 역할·동의 상태와 생리·예측 입력 원본 |
| users/{uid}/privateDailyLogs/{logId} | 본인 | 본인 | 증상·기분·컨디션·메모 원본 |
| users/{uid}/shareSettings/{pairId} | 본인 | 본인 | 현재 Pair에만 적용되는 필드별 공유 동의 |
| users/{uid}/pairMemberships/{pairId} | 본인 | 서버 전용 | 본인용 Pair 상태 mirror |
| users/{uid}/cacheTombstones/{id} | 본인 | 서버 전용 | 이전 상대 캐시 삭제 명령, callable로 ack |
| pairs/{pairId} | active 멤버 | 서버 | 정확히 2개 UID, 상태, 생성·해제 시각 |
| pairs/{pairId}/projections/{ownerUid} | owner와 active partner | 서버 전용 | 허용된 공유 키만 포함 |
| pairInvites/{inviteHash} | 서버 전용 | 서버 전용 | code hash, creator, 상태, 만료 |
| pairBindings/{uid} | 서버 전용 | 서버 전용 | 사용자당 active Pair 단일성 |
| connectionStates/{uid} | 서버 전용 | 서버 전용 | invite epoch와 rate limit |
| pairTombstones/{pairId} | 서버 전용 | 서버 전용 | revoke 감사·cleanup 기준 |
| subscriptions/{uid} | 본인 | 서버 전용 | 검증된 entitlement snapshot |

Firestore Rules는 문서 읽기 중 일부 필드를 가릴 수 없다. 따라서 원본과 projection을 같은 문서에 두지 않는다. Rules는 경로 단위 접근을 거부하고, projection 생성은 Admin SDK를 사용하는 서버 코드가 별도로 검증한다. 근거는 [Firebase의 field access 공식 문서](https://firebase.google.com/docs/firestore/security/rules-fields)다.

## Pair 불변식

- memberIds 길이는 항상 2다.
- 두 UID는 달라야 한다.
- 멤버당 active Pair는 최대 1개다.
- Pair 생성과 양쪽 activePairId 반영은 transaction으로 처리한다.
- 클라이언트는 Pair 문서, projection, invite 상태를 직접 생성하거나 수정하지 못한다.
- 고정 Logger/Companion role 대신 각 Member가 recordsCycles를 가진다.
- 공유 설정은 Pair ID에 귀속하며 새 Pair에 이전 설정을 승계하지 않는다.

## 초대

- createInvite, acceptInvite는 callable Function 후보다.
- 초대 코드는 원문을 저장하지 않고 hash만 저장한다.
- 1회성이며 만료시간은 24시간이다.
- 사용자당 60분 동안 최대 5개 생성으로 rate limit한다.
- 자기 초대와 이미 연결된 사용자 수락을 차단한다.
- 수락 시 Pair와 사용자 연결 상태를 하나의 transaction으로 만든다.
- 만료된 invite 문서는 `expiresAt` 후 7일 보존하고 daily schedule이 정리한다.

## partner projection

공통 메타데이터 후보:

- schemaVersion
- pairId
- subjectMemberId
- generatedAt
- asOf

동의 시에만 존재할 수 있는 값:

- cyclePhase 중 menstrual, follicular, luteal, unknown
- nextPeriodWindow와 confidence
- periodDates의 실제 생리 시작일과 선택적 종료일
- symptoms
- mood
- energy
- condition
- helpPreferences
- note

`cyclePhase`는 비가임 주기 국면만 허용한다. 시작·진행·마무리·직후·시작 전 같은 `cycleStatus`와 `ovulatory`/`fertile-window`용 `fertilityStatus`는 각각 별도 opt-in이 있을 때만 partner projection에 넣는다. 기존 설정처럼 키가 누락된 경우는 false로 처리한다. 공유가 꺼진 키는 삭제하고 이전 값이 남지 않게 갱신한다.

## 연결 해제와 캐시 회수

~~~mermaid
sequenceDiagram
  participant A as 해제 요청자
  participant F as revokePair Function
  participant DB as Firestore
  participant B as 오프라인 상대
  A->>F: 연결 해제
  F->>DB: Pair revoked, projection 삭제
  F->>DB: B 전용 cache tombstone 생성
  Note over DB: Rules는 즉시 이전 partner 접근 거부
  B->>DB: 다음 온라인 동기화
  DB-->>B: tombstone
  B->>B: 상대 캐시 삭제
  B->>DB: ack
~~~

owner-private 원본은 연결 해제만으로 삭제하지 않는다. 계정 삭제는 raw data, projection, invite, FCM token, subscription snapshot을 별도 recursive cleanup으로 처리한다. cache tombstone은 앱이 캐시 삭제를 완료해 `acknowledged`가 된 시점부터 30일 보존한다. pending/unacknowledged tombstone은 cleanup 대상이 아니며, query 뒤 transaction 재검증으로 상태 경합 시 삭제를 거부한다. 별도 Pair 감사로그와 백업 삭제 약속은 개인정보 처리방침 확정 전까지 출시 blocker다.

## 날짜와 동기화

- 건강 기록 날짜는 YYYY-MM-DD LocalDate로 저장한다.
- 알림 예약에만 사용자 IANA time zone을 사용한다.
- 오프라인 변경에는 client mutation ID와 server updatedAt을 둬 중복 반영을 막는다.
- 공유 설정 변경과 연결 해제는 보안상 server authoritative다.
- 오래된 projection에는 asOf를 표시한다.

## 알림 경계

- FCM payload 제목·본문은 중립 문구만 사용한다.
- 생리, PMS, cyclePhase, 증상, 기분, 이름은 잠금화면 payload에 넣지 않는다.
- 상세 내용은 로그인·Pair 상태·projection 권한을 다시 확인한 뒤 앱 내부에서 조회한다.
- FCM token은 사용자별 private 경로에 두고 Analytics ID와 결합하지 않는다.

## Analytics 경계

금지 payload:

- 날짜, 증상, 기분, 메모, condition, helpPreferences
- cyclePhase와 예측일
- UID, Pair ID, 초대코드
- 자유 텍스트

허용 payload는 화면·퍼널의 비민감 상태와 개수처럼 제한한다. 로그와 Crashlytics breadcrumb에도 같은 금지 규칙을 적용한다.

## E2E 암호화

MVP에서는 Firebase 저장·전송 암호화, Rules, projection 분리, 최소 수집을 사용한다. 모바일 App Check attestation 경로는 구현했지만 운영 provider 등록과 Firestore/Callable 강제는 release gate로 남아 있어 현재 배포를 App Check 보호 상태로 표현하지 않는다. E2E는 서버 예측·알림·복구·다기기 동기화와 충돌하므로 이번 MVP에서 구현하지 않는다. 출시 전 위협모델을 검토하고, 실제 위험과 기능 요구를 바탕으로 후속 ADR에서 다시 결정한다.

## release invariant

- pnpm test:core는 device, Firebase, network 없이 실행된다.
- pnpm check:architecture는 core의 플랫폼 import를 거부한다.
- Rules emulator 테스트가 owner-private 경로와 projection 경계를 증명한다.
- market config에 확정 필요가 남아 있으면 check:release는 실패해야 한다.
- 배포와 스토어 제출은 별도 사용자 승인을 기다린다.
