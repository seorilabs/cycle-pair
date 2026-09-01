# Google Play readiness

현재 상태는 release candidate와 internal 업로드 경로가 준비됐으며 production 배포는 불가하다. 마켓 메타데이터 source of truth는 [google-play.config.json](../play-store/google-play.config.json), artifact·Console·수동 검증 evidence는 [readiness.json](../release/readiness.json)이다.

한국어 출시 이름은 `사이클 페어 : 내 기분, 주기, 컨디션을 알려요`, 영어 출시 이름은 `Cycle Pair`, 영구 Android package name은 `com.seorilabs.cyclepair`로 확정했다. Play Console 앱 shell과 v0.1.8 internal artifact는 존재한다. 2026-08-21 Cloud Build에서 v1.0.1/1000001 signed AAB 후보를 생성·검증했지만 Play Console에는 업로드하지 않았다.

Android `targetSdkVersion`은 36이다. 현재 API 35 최소 기준을 충족하며, 2026-08-31부터 적용되는 신규 앱·업데이트 API 36 기준에도 맞춘 값이다. 제출 시점에는 [Google 공식 요구사항](https://developer.android.com/google/play/requirements/target-sdk)을 다시 확인한다.

## Android release signing

Debug 빌드는 저장소의 debug keystore만 사용하며 서명 비밀값 없이 실행할 수 있다. Release 빌드는 debug keystore로 fallback하지 않는다. upload key 설정이 없거나 `debug.keystore`를 지정하면 `preReleaseBuild`의 `verifyReleasePrerequisites` gate가 운영 Firebase와 서명 문제를 함께 열거하고 중단한다. 서명만 독립 확인할 때는 `./gradlew :app:verifyReleaseSigning`을 사용한다.

로컬에서는 예제 파일을 복사한 뒤 실제 upload keystore의 저장소 외부 절대 경로와 비밀값을 입력한다. `keystore.properties`와 keystore 파일은 Git에서 무시된다.

~~~bash
cp apps/mobile/android/keystore.properties.example apps/mobile/android/keystore.properties
pnpm --filter @cyclepair/mobile build:android:debug

# deployment approval 후 release candidate를 만들 때만 실행
pnpm build:google-play
~~~

`pnpm build:google-play`은 중앙 workflow가 주입한 `SEORI_RELEASE_VERSION_NAME`과
`SEORI_RELEASE_VERSION_CODE`만 Gradle에 투영한다. package version은 개발 기본값이며
마켓 release version을 결정하지 않는다.

Backoffice의 앱별 `릴리스 > 빌드 산출물`에서는 exact stable `vX.Y.Z` 태그를 선택해
동일한 release signing·production Firebase gate를 통과한 signed AAB를 생성한다.
전용 build-only workflow는 private ARC에서 WIF로 x64 Cloud Build만 제출하고,
signed AAB를 회수해 3일 보관한다. `배포 > Google Play`는 같은 Cloud Build 경로로
사용자가 승인한 태그를 다시 빌드하고, `upload=true`일 때만 `internal` 트랙에
업로드한다. 테스터 QA와 production 승격은 별도 단계다.

로컬·에뮬레이터용 프로젝트 기본값은 네 ABI를 유지하되, GitHub의 signed release AAB는
`armeabi-v7a,arm64-v8a`만 컴파일한다. 지원하는 ARM 32비트 ABI에 대응하는 64비트 ABI를
함께 포함해 [Google Play 64비트 요구사항](https://developer.android.com/google/play/requirements/64-bit)을
지키면서 release에서 사용하지 않는 x86 CMake 반복 컴파일을 제거한다. 기존 GitHub-hosted
재사용 workflow는 Gradle wrapper와 dependency cache를 함께 복원했다. 최적화 전 `v1.0.2`
실행의 signed AAB job은 33분 31초였다. 최적화 SHA `6a51fbf`의 build-only candidate는
[cold cache에서 22분 48초](https://github.com/seorilabs/cycle-pair/actions/runs/31990357687),
[Gradle cache hit에서 16분 18초](https://github.com/seorilabs/cycle-pair/actions/runs/31991645468)로
각각 10분 43초(32%), 17분 13초(51%) 짧아졌다. 두 산출물 모두 ARM ABI 두 개와
유효한 JAR 서명을 재검증했다. cache-hit 실행도 Gradle의 642개 task를 모두 실행했으므로,
16분 18초를 task output cache 자체의 효과로 단정하지 않고 반복 빌드 실측치로만 사용한다.
이 기록은 Cloud Build 전환 전 기준선이다. 2026-08-21 global Cloud Build
`c6d005cc-430c-4d1c-a8d3-54447d5cf26c`은 12분 35초에 성공했고, 내부 Gradle
release build는 7분 3초였다. 생성된 v1.0.1/1000001 AAB는 40,205,088바이트,
SHA-256 `3ff29f686664aed8b6b7979430d92aa0be218b3661e39d6407b82468d950b8b2`다.
`bundletool validate`, trusted `jarsigner -verify -strict`, package·version·SDK·ARM ABI
readback을 모두 통과했고 upload certificate SHA-256은 등록값과 일치했다. 이 artifact는
GCS build evidence이며 Google Play 업로드·테스터 QA·production 배포 증거가 아니다.

CI는 파일 대신 아래 환경변수를 사용할 수 있다. 값이나 keystore를 로그·artifact·저장소에 남기지 않는다.

- `CYCLEPAIR_ANDROID_UPLOAD_STORE_FILE`
- `CYCLEPAIR_ANDROID_UPLOAD_STORE_PASSWORD`
- `CYCLEPAIR_ANDROID_UPLOAD_KEY_ALIAS`
- `CYCLEPAIR_ANDROID_UPLOAD_KEY_PASSWORD`

서명 artifact를 만들고 별도로 검증한 뒤 `release/readiness.json`의 `artifacts.googlePlaySignedAab`에 repo-relative path, SHA-256, 검증 시각, evidence를 기록한다. 파일 또는 hash가 달라지면 `check:release`가 다시 차단한다.

## 확정된 내용

- 앱 유형: app
- 한국어 앱 이름: 사이클 페어 : 내 기분, 주기, 컨디션을 알려요
- 영어 앱 이름: Cycle Pair
- package name: com.seorilabs.cyclepair
- 기본 locale: ko-KR
- 카테고리: Health & Fitness
- 광고: 없음
- 실시간 채팅과 공개 커뮤니티: 없음
- 비공개 메모·공동 일정은 사용자 생성 콘텐츠로 수집 신고
- 주기 기반 가임 가능 시기: 별도 Pair 공유 동의로 제공, 피임 판단과 정확한 배란일 표시는 없음
- 다운로드: 무료, 구독 기준 가격: 월 KRW 3,900 / 연 KRW 29,000, 타 통화는 스토어 자동 환산
- 구독 contract: product `cyclepair_plus`, base plan `monthly` / `yearly`, 7일 체험 offer `free-trial`
- 배포: EU·한국을 포함한 전체 storefront, 만 17세 이상, 비게임 앱
- 고객지원 이메일: cs@seorilabs.com
- 최초 테스트 트랙: internal

## Data safety 답변안

실제 SDK와 동의 흐름 기준 선언은 `play-store/policy/data-safety-declaration.json`과 공식 CSV를 source of truth로 한다. 사용자 검토 뒤에만 Console에 저장하고 readback evidence를 남긴다.

| 데이터 | 목적 | 처리 |
| --- | --- | --- |
| 이메일·User ID | 로그인·Pair 연결 | Firebase Auth, 광고 추적 없음 |
| 생리일·증상·기분 | 앱 기능 | owner-private 저장 |
| 비공개 메모·공동 일정 | 앱 기능 | owner-private 또는 Pair 범위 UGC |
| 사용자가 선택한 projection | 사용자 요청 공유 | 정확히 한 partner에게만 제공, 사용자 직접 실행 예외 |
| 알림 token | 앱 기능 | 중립 알림 발송 |
| 구독 entitlement | 결제·부정 사용 방지 | 서버 영수증 검증 |
| 앱 활동 이벤트 | 분석 | 민감 값·cyclePhase 없음 |
| crash·성능 진단 | 안정성 | PII·자유 텍스트 없음 |

Firebase 처리는 service provider, partner projection과 시스템 공유는 사용자 직접 실행 예외로 근거를 남겨 제3자 공유는 없음으로 신고한다. 제출 직전에 Google Play 공식 정의를 다시 확인한다.

## blocker

- [x] free/paid 최초 선택: 무료
- [x] Play Console 앱 shell
- [x] privacy policy URL과 계정 삭제 URL 게시
- [ ] Data safety 검토·입력
- [ ] target audience와 IARC Console 저장/readback
- [x] 저장소·런타임 구독 product ID, 기준 가격, 혜택 정합성
- [x] Play Console base plan 활성화와 readback: 2026-08-11 Android Publisher API로 월간·연간 173개 지역, KRW 3,900·29,000, `free-trial` P7D ACTIVE 확인
- [x] 1024x500 feature graphic과 실제 phone screenshots
- [x] large/xlarge 지원 기준 7-inch·10-inch tablet screenshots 각 2장 이상
- [x] v1.0.1/1000001 signed AAB Cloud Build와 독립 서명·bundle 검증
- [ ] repo-local artifact를 사용하는 `release/readiness.json` evidence 등록
- [ ] production Firebase Play Integrity App Check provider 등록과 Firestore/Callable 강제 live 검증
- [ ] internal track 2인 테스트
- [ ] production access와 deployment 승인

## 준비 후 검증

~~~bash
python3 ${AGENT_HOME:-$HOME/.agent}/skills/google-play-store-registration/scripts/validate_play_store_config.py --root .
pnpm check:release
~~~

확정 필요 값이 남아 있는 현재 validator 실패는 정상이다. Console-only 정책 게이트는 API 적용 성공만으로 완료 처리하지 않는다.
