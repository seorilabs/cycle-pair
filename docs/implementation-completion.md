# Cycle Pair 구현 현황과 완성 기준

## 상태

- 기준일: 2026-07-14
- 목표: 부분 구현 또는 정적 UI로 남은 MVP 기능을 실제 모바일·Firebase 동작으로 완성
- 범위: Google Play·App Store용 `apps/mobile`, 공통 Firebase backend, AppsInToss 최소 로컬 공유 slice와 독립 빌드 타깃
- 제외 유지: 다중 파트너, 실시간 채팅, 광고, 가임기·배란·피임 기능, E2E 암호화, AppsInToss의 계정·Firebase·알림·구독 parity와 콘솔 배포. AppsInToss 최소 로컬 공유 slice와 빌드 타깃은 별도 구현
- 현재 단계: 실제 adapter를 연결한 MVP 내부 alpha/closed beta 후보. 운영 배포·마켓 제출 준비 완료 상태가 아님

`code 구현`과 `출시 검증`은 다른 상태다. 아래의 `구현됨`은 코드·자동 테스트 범위를 뜻하며, 실기기·sandbox·콘솔·배포 근거까지 완료됐다는 뜻이 아니다.

## 구현 매트릭스

| 영역 | 코드 상태 | 현재 검증 근거 | 출시 전 남은 근거 |
| --- | --- | --- | --- |
| 기록·달력 | 구현됨 | 다일 기록·주기 시작/종료·재실행 복원, 캘린더 개별 삭제·암호화 오프라인 재시도·projection 재계산 unit/mobile/emulator tests | 두 OS 실기기 삭제·오프라인 복구 회귀 QA |
| 암호화 오프라인 | 구현됨 | Keychain cache/queue, UID·Pair fence, 멱등 flush·logout drain unit tests | 네트워크 차단/복구 실기기 QA |
| Pair·공동 일정 | 구현됨 | solo 진입, 초대·수락·해제, projection·event 코드/테스트, Rules 경계 | 최신 Functions 배포 후 2계정·2기기 E2E |
| 인증·계정 | 구현됨 | 익명/email 승격·인증·reset·재인증·로그아웃, 삭제 receipt·Auth 소멸 후 복구를 포함한 unit/mobile·격리 Emulator E2E | 양 OS 실기기 삭제·응답 유실 회귀 |
| 내보내기·삭제 | 구현됨 | 5분·단회 download ticket, recursive cleanup, deletion barrier Functions tests | 개발 배포 후 HTTPS/IAM·재인증·재시도 live smoke |
| 알림 | 구현됨 | opt-in, token 등록/회수, quiet hours, 중립 payload unit/Functions tests | APNs 키·권한, Android/iOS 실기기 수신 |
| Analytics·Crashlytics | 구현됨 | allowlist schema·scrubber unit tests | DebugView·non-fatal 실기기 smoke와 최종 privacy 공개 |
| App Check | 클라이언트 구현됨 | dependency·환경 fail-closed·provider 선택 unit/static tests | production provider 등록, Firestore/Callable 강제 live evidence, 양 OS 실기기 token smoke |
| 구독 | 구현됨, 판매 flag `false` | Play/Apple adapter, server-only entitlement, RTDN/Notifications V2 Functions tests | 양대 콘솔 상품·secret·webhook, sandbox 구매/복원 |
| AppsInToss | 최소 slice 구현됨 | SDK 2.x RN 0.84 + TDS, 로컬 컨디션·도움 선호 선택, 공식 공유 화면, lint·typecheck·unit·`.ait` build | 영구 `appName`, 정책 검토, 정식 자산, 콘솔 등록, sandbox QA. Firebase·Pair·알림·구독 parity는 별도 범위 |
| CI·release checker | 작성됨 | 로컬 action 버전·구조 검사, production evidence·실제 artifact verifier·git provenance 회귀 포함 release checker 31 tests | workflow commit/push 후 HEAD check run·required check 설정 |

## 구현 불변식

- 민감한 원본 기록과 offline mutation은 평문 AsyncStorage에 저장하지 않는다.
- 모든 offline mutation은 `mutationId`를 가지며 서버 저장은 동일 ID 재전송에 안전해야 한다.
- 공동 일정은 active Pair에만 귀속하고 Pair 해제 후 이전 멤버가 읽거나 쓸 수 없어야 한다.
- Firebase Admin SDK 경로는 작업에 맞는 권한 근거를 직접 확인한다. 사용자 mutation은 Auth·대상 UID·필요 시 active Pair/최근 재인증을, 삭제 완료 복구는 256-bit receipt hash를, provider webhook과 내보내기 다운로드는 각각 provider 서명과 단회 ticket을 검증한다.
- 데이터 내보내기 원문과 raw download token은 Firestore·Storage·로그에 저장하지 않으며, 5분 만료·단회 token hash만 서버가 관리한다.
- 로그아웃은 현재 UID의 FCM token unregister와 알림·진단 opt-in reset을 Auth sign-out 전에 완료하고, 계정 삭제는 server recursive token cleanup을 최종 보장으로 둔다.
- Analytics·Crashlytics·FCM payload에는 건강정보, 날짜, UID, Pair ID, 초대코드, 자유 텍스트를 넣지 않는다.
- entitlement 문서는 클라이언트가 직접 쓰지 못하며 Google Play·App Store 검증 결과만 반영한다.
- 운영 제출과 마켓 production promotion은 별도 deployment approval 전에는 수행하지 않는다.

## 외부 콘솔 게이트

아래 값은 코드로 임의 생성하지 않고 실제 콘솔 설정과 함께 확정한다.

- Google Play·App Store 구독 product ID, 가격, 체험 기간
- Google Play service account와 Real-time Developer Notifications
- App Store Connect API key, App Store Server Notifications V2, subscription shared secret 사용 여부
- iOS APNs key와 Push Notifications capability
- production Firebase project, production Auth provider, App Check provider 등록·Firestore/Callable enforcement live evidence
- 내보내기 HTTPS endpoint·만료 ticket cleanup schedule 배포, Domain Restricted Sharing invoker 설정, legacy raw JSON callable 제거

## 현재 판정

- scoped MVP 코드: 내부 alpha/closed beta 후보 수준
- 운영 backend: 최신 source 미배포. 2026-07-13 dev 배포 검증을 production 근거로 사용하지 않음
- 마켓: 서명·상품·개인정보·스토어 자산·콘솔 QA 미완료
- 제출/배포: deployment approval 전이며 production-ready가 아님
