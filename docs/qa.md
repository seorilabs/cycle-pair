# MoonMate QA

## 게이트

| 게이트 | 명령 | 증명 범위 |
| --- | --- | --- |
| core | pnpm test:core | 순수 도메인·예측·Pair·공유 필터 |
| architecture | pnpm check:architecture | product-core 플랫폼 SDK import 금지 |
| mobile | pnpm check:mobile | RN lint, typecheck, unit test, iOS/Android production JS bundle |
| Firebase 전체 | pnpm test:firebase 또는 pnpm check:firebase | Functions build·unit test, Rules emulator, Auth/Firestore/Functions E2E |
| 전체 | pnpm lint && pnpm typecheck && pnpm test | repo 정적·자동 테스트 |
| release inventory | pnpm check:release | 마켓·Firebase·privacy blocker 목록 |

check:release는 현재 의도적으로 실패해야 한다. 영구 ID, 정책 답변, 서명 빌드, 콘솔 입력이 확정되지 않았기 때문이다.

## 2026-07-12 구현 슬라이스 검증 현황

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| product-core | PASS | 6 files, 32 tests; architecture/typecheck/build PASS |
| mobile | PASS | ESLint, TypeScript, Jest 4 suites/11 tests, iOS/Android production JS bundle |
| Firebase Functions | PASS | TypeScript build, 정책/projection 9 tests |
| Firestore Rules | PASS | Emulator 8 tests |
| Firebase 통합 | PASS | Auth+Firestore+Functions Emulator 1 E2E, 7 functions load |
| 실제 Firebase Auth·Rules | PASS | `seorilabs-moonmate-dev`, anonymous auth 활성화, 서울 Firestore, owner write/read 200·other read 403 후 테스트 계정/데이터 삭제 |
| 실제 Firebase Functions | BLOCKED | 프로젝트 결제 연결 권한 403로 `asia-northeast3` 배포 미완료 |
| iOS native | PASS | Xcode clean Debug build, iPhone 16 Pro Simulator 설치·기동, 온보딩 화면 확인 |
| Android native | PASS | JDK 17 `assembleDebug`, 4 ABI build |
| release inventory | EXPECTED FAIL | 출시 이름·영구 ID·정책·서명·콘솔·deployment approval 미확정 |

현재 자동 QA는 로컬 product-core, UI 세로 슬라이스, Firebase emulator 보안 경계와 실제 개발 프로젝트의 Auth·owner-private Rules를 증명한다. Functions 배포 전이므로 Android/iOS 실제 2인 초대·수락·projection 동기화, 계정 삭제·내보내기, FCM, 결제, 스토어 산출물은 아직 증명하지 않는다.

## core 필수 테스트

- Pair는 정확히 서로 다른 두 Member만 허용
- 사용자당 active Pair 하나
- 주기 날짜는 LocalDate로 계산
- 유효 간격 15~60일만 예측에 사용
- 표본 수·변동성에 따른 confidence와 window
- ovulation·ovulatory 결과가 UI/projection/Analytics로 전달되지 않고 비가임 phase만 명시적 공유 시 전달됨
- 공유 기본값 전체 false
- Pair 교체 시 이전 Pair의 공유 설정을 승계하지 않음
- 허용된 키만 projection에 존재
- 공유 OFF 후 이전 projection 키 제거
- multiple-connections entitlement 비활성
- 중립 알림 payload에 건강정보 없음

## Firebase 보안 테스트

Emulator에서 최소 다음을 자동 검증한다.

1. owner는 자기 private profile, cycles, dailyLogs를 읽고 쓸 수 있다.
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
- mm_cycle_log는 payload 없이 성공 사실만 보낸다.
- mm_care_tip_view에 phase가 없다.
- Crashlytics error message와 breadcrumb에 자유 텍스트 기록이 없다.
- 초대코드, Firebase token, 영수증 원문을 로그에 남기지 않는다.

## 알림 테스트

- iOS와 Android 잠금화면 title/body가 중립 문구다.
- notification payload에 파트너 이름, 생리, PMS, 증상, 날짜가 없다.
- opt-out과 조용한 시간에 발송하지 않는다.
- 알림에서 앱 진입 후 현재 auth와 active Pair를 다시 확인한다.

## 2인 실제 기기 시나리오

| 시나리오 | 기기 A | 기기 B | 합격 조건 |
| --- | --- | --- | --- |
| 연결 | 초대 생성 | 다른 계정으로 수락 | 정확히 하나의 active Pair |
| 기본 프라이버시 | 기록 저장 | 상대 화면 조회 | 건강 필드가 보이지 않음 |
| 선택 공유 | mood만 켬 | 새로고침 | mood만 보임 |
| 공유 회수 | mood 끔 | 새로고침 | 이전 mood도 사라짐 |
| 오프라인 해제 | Pair 해제 | 오프라인 유지 | 서버 접근 즉시 차단 |
| tombstone | 해제 완료 | 다시 온라인 | 상대 캐시 삭제 후 ack |
| 계정 삭제 | 삭제 요청 | 상대 화면 조회 | projection과 관계 제거 |
| 구독 | sandbox 결제 | entitlement 재조회 | 서버 검증 상태만 반영 |

## 모바일·접근성

- 작은 Android와 iPhone 화면에서 주요 CTA가 가려지지 않는다.
- Dynamic Type, screen reader label, 색 대비, 터치 영역을 확인한다.
- 네트워크 끊김과 재시도 상태가 구분된다.
- 오래된 캐시에는 asOf가 표시된다.
- 한국어 긴 문구와 영문 fallback에서 레이아웃이 깨지지 않는다.
- iOS LaunchScreen과 Android launch theme가 제품 브랜딩이며 framework 기본 문구가 없다.

## 마켓 QA

- Google Play: signed AAB, internal track 2인 테스트, Data safety와 실제 SDK 일치
- App Store: archive, TestFlight 2인 테스트, App Privacy와 실제 SDK 일치
- AppsInToss: 정책 적합성 승인 전 빌드·preview·콘솔 QA를 시작하지 않음

## 사람 승인

- planning 승인: 완료
- agent QA: 현재 로컬 구현 슬라이스 완료 (2026-07-12)
- 2인 사람 테스트: 미완료
- deployment 승인: 미완료
