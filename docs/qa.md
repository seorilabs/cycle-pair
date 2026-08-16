# Cycle Pair QA

## 게이트

| 게이트 | 명령 | 증명 범위 |
| --- | --- | --- |
| core | pnpm test:core | 순수 도메인·예측·Pair·공유 필터 |
| architecture | pnpm check:architecture | product-core 플랫폼 SDK import 금지 |
| mobile | pnpm check:mobile | RN lint, typecheck, unit test, iOS/Android production JS bundle |
| AppsInToss | pnpm check:ait && pnpm build:ait | SDK 2.x RN lint, typecheck, unit test, iOS/Android `.ait` bundle |
| Firebase 전체 | pnpm test:firebase 또는 pnpm check:firebase | Functions build·unit test, Rules emulator, Auth/Firestore/Functions E2E |
| Firebase 실제 prod | `CYCLEPAIR_ALLOW_PRODUCTION_SMOKE=true pnpm test:firebase:live` | 플랫폼 Custom Token·Auth·callable·3종 projection trigger·revoke·cleanup |
| 전체 | pnpm lint && pnpm typecheck && pnpm test | repo 정적·자동 테스트 |
| release inventory | pnpm check:release | 마켓·Firebase·privacy blocker 목록 |

check:release는 현재 의도적으로 실패해야 한다. 정책 답변, 서명 빌드, 콘솔 입력과 deployment approval이 확정되지 않았기 때문이다.

## 2026-07-14 구현 검증 스냅샷

아래는 문서 작성 시점까지 실제로 PASS가 확인된 단위별 결과다. 각 결과는 실행 시점의 worktree를 증명하며, 모든 후속 변경을 포함한 하나의 최종 release gate를 의미하지 않는다.

| 항목 | 결과 | 증거·한계 |
| --- | --- | --- |
| product-core | PASS | 7 files, 42 tests; architecture PASS |
| mobile lint·typecheck·unit | PASS | ESLint, TypeScript, Jest 29 suites/184 tests |
| `check:mobile` | PASS | 최신 worktree에서 native Firebase selector, ESLint, TypeScript, Jest 29 suites/184 tests, iOS/Android production JS bundle을 한 번에 검증 |
| Firebase Functions | PASS | Node.js 22, 11 files/61 tests; build PASS |
| Firestore Rules | PASS | Emulator 19 tests |
| App Check client/static | PASS | 환경·provider·fail-closed gate·재시도 targeted Jest 3 suites/8 tests, dependency·초기화·운영 evidence checker tests. 운영 token/강제 상태는 미검증 |
| release checker unit | PASS | 31 tests; native Firebase selector, App Check, production capability·deployment provenance, AAB JAR signature·xcarchive plist/codesign 검사 PASS |
| Android native | PASS | JDK 17 Debug APK에 RNFB App Check·Debug/Play Integrity provider가 링크되어 재빌드됨. `com.seorilabs.cyclepair`, 연결 실기기에서 solo 홈·기록 화면·hardware back·계정 설정을 확인했고 치명 로그 없음 |
| iOS native | PASS | RNFB App Check·App Attest entitlement가 링크된 arm64 Simulator clean Debug build. 생성된 `Info.plist`의 global collection=false·App Check token refresh=true 검증 |
| Firebase 전체·통합 | PASS | Node.js 22 `pnpm --dir firebase check`: Functions build, 61 unit tests, Rules 19 tests, Auth+Firestore+Functions Emulator E2E 5 tests. 외부 credential을 차단하고 repo 전용 port 9399/8380/5301 사용 |
| release inventory | EXPECTED FAIL | production Firebase/config/deployment, 서명, 마켓 콘솔·정책, privacy, deployment approval blocker를 정상 탐지 |

따라서 현재 판정은 `production-ready`가 아니라 `내부 alpha/closed beta 후보`다. `seorilabs-cyclepair-dev`의 2026-07-13 live 배포는 과거 기록이며 현재 source나 단일 prod 프로젝트의 배포 검증으로 간주하지 않는다.

## 2026-08-06 단일 prod 전환 검증

| 항목 | 결과 | 증거·한계 |
| --- | --- | --- |
| Firebase 프로젝트 | PASS | `seorilabs-cyclepair-prod` ACTIVE. legacy `seorilabs-cyclepair-dev`, `seorilabs-moonmate-dev`는 데이터 이전 없이 삭제 요청 후 모두 `DELETE_REQUESTED` |
| 운영 Auth·Pair | PASS | 소스 기본 Platform URL로 `pb_` Custom Token 2개를 Firebase ID token으로 교환하고 초대·수락·해제 전 구간 통과 |
| Rules·trigger | PASS | 현재 cycle schema v1, daily schema v2, server timestamp 계약으로 3종 projection, owner-private deny, 공유 회수, tombstone ack와 테스트 데이터 cleanup 통과 |
| Functions runtime IAM | PASS | prod compute SA에 누락된 `roles/datastore.user` 보정 후 예약 함수 3종을 즉시 실행해 Cloud Run HTTP 200 확인 |
| Android native | PASS | prod `google-services.json`, `com.seorilabs.cyclepair` 검증과 `assembleDebug` 성공 |
| iOS native | PASS | prod `GoogleService-Info.plist`, `com.seorilabs.cyclepair` 검증, Pods 설치와 서명된 iPhone 16 Pro iOS 18.1 시뮬레이터 빌드·설치·온보딩 기동 성공. Keychain read/write 정상 |
| App Check | MONITORING | Play Integrity·App Attest config 존재, Firestore·Auth·Storage `UNENFORCED`, Callable 강제 false. Android Play app-signing SHA-256과 release 실기기 token 검증 전에는 강제 금지 |
| 배포 provenance | 미완료 | live 동작은 확인했지만 현재 source fingerprint와 배포 revision의 동일성은 별도 deployment gate로 유지 |

## 2026-07-13 Cycle Pair 전환 검증 현황

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| product-core | PASS | 6 files, 32 tests; architecture/typecheck/build PASS |
| mobile | PASS | ESLint, TypeScript, Jest 4 suites/24 tests, iOS/Android production JS bundle |
| Firebase Functions | PASS | TypeScript build, 정책/projection 9 tests |
| Firestore Rules | PASS | Emulator 8 tests |
| Firebase 통합 | PASS | Auth+Firestore+Functions Emulator 1 E2E, 7 functions load |
| 실제 Firebase Auth·Rules | 과거 PASS | `seorilabs-cyclepair-dev`의 Firebase Anonymous Auth 기반 과거 검증. 현재 플랫폼 Custom Token 경로의 근거로 재사용하지 않음 |
| Firebase 개발 결제 | PASS | 기존 Seorilabs 앱과 동일한 결제 계정 연결, `billingEnabled: true` 재조회 |
| 실제 Firebase Functions | PASS | Node.js 22 2nd Gen 7개, `asia-northeast3`, 전부 ACTIVE |
| 실제 Firebase 2계정 | PASS | 익명 계정 2개 초대·수락, 기본 비공개, cycle·daily·shareSettings trigger, 공유 회수, revoke·양쪽 tombstone ack, 테스트 계정·문서 cleanup |
| iOS native | PASS | `CyclePair` scheme, `com.seorilabs.cyclepair`, arm64 iPhone 16 Pro Simulator build·설치·온보딩 기동 |
| Android native | PASS | JDK 17 daemon 선택, `com.seorilabs.cyclepair` `assembleDebug`, Seeker Android 16 실기기 설치·세로 기동·온보딩 hardware back·solo 홈·선택형 Pair 진입/복귀 |
| release inventory | EXPECTED FAIL | 운영 Firebase·App Check·정책·서명·마켓 콘솔·deployment approval 미확정 |

현재 자동 QA는 로컬 product-core, UI 세로 슬라이스, Firebase emulator 보안 경계와 Functions 계정 lifecycle을 증명한다. 플랫폼 Custom Token을 포함한 prod live smoke는 2026-08-06 완료했다. Android/iOS 실제 기기 2대 UI 흐름, 제품 계정 삭제·내보내기, FCM, 구독 결제, 스토어 산출물은 별도 실검증이 필요하다.

## core 필수 테스트

- Pair는 정확히 서로 다른 두 Member만 허용
- Pair 없이도 owner-private 설정·기록·예측 화면에 진입 가능
- 사용자당 active Pair 하나
- 주기 날짜는 LocalDate로 계산
- 유효 간격 15~60일만 예측에 사용
- 표본 수·변동성에 따른 confidence와 window
- 시작·진행·마무리·직후·시작 전 상세값은 `cycleStatus`, ovulatory·fertile-window는 `fertilityStatus`가 각각 true일 때만 UI/projection으로 전달되고 Analytics 값에는 포함되지 않음. 일반 `cyclePhase` 동의만으로는 상세 상태나 가임 가능 상태가 노출되지 않음
- 공유 기본값 전체 false
- Pair 교체 시 이전 Pair의 공유 설정을 승계하지 않음
- 허용된 키만 projection에 존재
- 공유 OFF 후 이전 projection 키 제거
- multiple-connections entitlement 비활성
- 중립 알림 payload에 건강정보 없음

## Firebase 보안 테스트

Emulator에서 최소 다음을 자동 검증한다.

1. owner는 자기 private profile, cycles, dailyLogs를 읽고 쓸 수 있으며 dailyLog를 삭제할 수 있다.
2. partner와 제3자는 owner-private 경로를 읽을 수 없다.
3. active partner는 자기 Pair의 projection만 읽을 수 있다.
4. projection에는 공유 OFF 필드가 존재하지 않는다.
5. 클라이언트는 Pair, projection, subscription snapshot을 직접 쓸 수 없다.
6. 자기 초대, 만료 초대, 재사용 초대, 세 번째 멤버를 거부한다.
7. revoke 직후 이전 partner의 projection read를 거부한다.
8. revoke가 양쪽 projection을 삭제하고 상대 전용 tombstone을 만든다.
9. tombstone은 대상 사용자만 읽고 ack할 수 있다.
10. 역할·동의를 포함한 private cycle setup도 owner만 읽고 쓸 수 있다.

## Analytics·로그 테스트

- 이벤트 schema에 date, symptom, mood, note, condition, helpPreferences, cyclePhase, UID, Pair ID가 없다.
- cp_cycle_log는 payload 없이 성공 사실만 보낸다.
- cp_care_tip_view에 phase가 없다.
- Crashlytics error message와 breadcrumb에 자유 텍스트 기록이 없다.
- 초대코드, Firebase token, 영수증 원문을 로그에 남기지 않는다.

## 알림 테스트

- iOS와 Android 잠금화면 title/body가 중립 문구다.
- notification payload에 파트너 이름, 생리, PMS, 증상, 날짜가 없다.
- opt-out과 조용한 시간에 발송하지 않는다.
- 알림에서 앱 진입 후 현재 auth와 active Pair를 다시 확인한다.
- 최초 스냅샷에는 인앱 알림이 없고, 이후 상대가 공유한 새 기록에는 토스트와 새 소식 메시지 박스가 함께 표시된다.
- 본인이 저장한 공동 일정 변경에는 상대 업데이트 토스트가 잘못 표시되지 않는다.

## 2인 실제 기기 시나리오

| 시나리오 | 기기 A | 기기 B | 합격 조건 |
| --- | --- | --- | --- |
| 연결 | 초대 생성 | 다른 계정으로 수락 | 정확히 하나의 active Pair |
| 기본 프라이버시 | 기록 저장 | 상대 화면 조회 | 건강 필드가 보이지 않음 |
| 선택 공유 | mood만 켬 | 새로고침 | mood만 보임 |
| 기록 삭제 | 최신 기록 삭제 | 상대 화면 조회 | 원본·암호화 캐시에서 제거되고 남은 최신 공유 기록으로 갱신 |
| 공유 회수 | mood 끔 | 새로고침 | 이전 mood도 사라짐 |
| 오프라인 해제 | Pair 해제 | 오프라인 유지 | 서버 접근 즉시 차단 |
| tombstone | 해제 완료 | 다시 온라인 | 상대 캐시 삭제 후 ack |
| 계정 삭제 | 삭제 요청 | 상대 화면 조회 | projection과 관계 제거 |
| 구독 | sandbox 결제 | entitlement 재조회 | 서버 검증 상태만 반영 |

## 모바일·접근성

- 작은 Android와 iPhone 화면에서 주요 CTA가 가려지지 않는다.
- 달력은 1900-01부터 2100-12까지 2,412개월 모두 6행×7열, 일요일 시작, 실제 월 일수, 연속 날짜와 요일 열이 일치한다.
- iOS 달력은 퍼센트 반올림과 무관하게 항상 7열이며 2026-08-24를 월요일 열에 표시한다.
- 초기 설정의 최근 시작일과 공동 일정 날짜는 iOS compact 피커·Android 날짜 다이얼로그로 선택하며, 최근 시작일은 오늘 이후를 선택할 수 없다.
- 가상 키보드가 열린 동안 스크롤 인셋이 조정되고 하단 탭과 새 소식 박스가 입력 CTA를 가리지 않는다.
- Dynamic Type, screen reader label, 색 대비, 터치 영역을 확인한다.
- 네트워크 끊김과 재시도 상태가 구분된다.
- 오래된 캐시에는 asOf가 표시된다.
- 한국어 긴 문구와 영문 fallback에서 레이아웃이 깨지지 않는다.
- iOS LaunchScreen과 Android launch theme가 제품 브랜딩이며 framework 기본 문구가 없다.

## 마켓 QA

- Google Play: signed AAB, internal track 2인 테스트, Data safety와 실제 SDK 일치
- App Store: archive, TestFlight 2인 테스트, App Privacy와 실제 SDK 일치
- AppsInToss: 로컬 최소 slice의 lint·typecheck·unit test·`.ait` build를 수행. 영구 `appName`은 `cycle-pair`로 고정했으며 정책 적합성, 정식 icon URL, 실화면 자산, Console 등록, sandbox QA는 별도 미완료 gate

## 사람 승인

- planning 승인: 완료
- agent QA: Cycle Pair 앱 정체성·dev Firebase 전환 완료 (2026-07-13)
- 2인 사람 테스트: 미완료
- deployment 승인: 미완료
