# Google Play readiness

현재 상태는 release candidate와 internal 업로드 경로가 준비됐으며 production 배포는 불가하다. 마켓 메타데이터 source of truth는 [google-play.config.json](../play-store/google-play.config.json), artifact·Console·수동 검증 evidence는 [readiness.json](../release/readiness.json)이다.

한국어 출시 이름은 `사이클 페어 : 친구/연인과 함께 컨디션을 공유해요.`, 영어 출시 이름은 `Cycle Pair`, 영구 Android package name은 `com.seorilabs.cyclepair`로 확정했다. Play Console 앱 shell과 release signing은 아직 만들지 않았다.

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

`pnpm build:google-play`은 root와 mobile package version이 같은지 먼저 확인하고, 해당 버전을 기존 `resolve-release-version.mjs`에 전달해 `versionName`과 단조 증가 `versionCode`를 함께 주입한다. 예를 들어 `0.1.0`은 versionCode `1000`, `0.1.1`은 `1001`이다. 다음 업로드 전에는 두 `package.json`의 version을 함께 올려야 하며, 필요하면 같은 버전의 `--tag vX.Y.Z`를 명시할 수 있다. 태그와 package version이 다르면 빌드는 중단한다.

Backoffice의 앱별 `릴리스 > 빌드 산출물`에서는 `vX.Y.Z` 태그를 선택해
동일한 release signing·production Firebase gate를 통과한 signed AAB를 생성한다.
전용 build-only workflow라 Google Play environment·WIF·API를 사용하지 않고 산출물만
3일 보관한다. `배포 > Google Play`는 사용자가 승인한 태그를 다시 빌드해 WIF로
`internal` 트랙에만 업로드한다. 테스터 QA와 production 승격은 별도 단계다.

CI는 파일 대신 아래 환경변수를 사용할 수 있다. 값이나 keystore를 로그·artifact·저장소에 남기지 않는다.

- `CYCLEPAIR_ANDROID_UPLOAD_STORE_FILE`
- `CYCLEPAIR_ANDROID_UPLOAD_STORE_PASSWORD`
- `CYCLEPAIR_ANDROID_UPLOAD_KEY_ALIAS`
- `CYCLEPAIR_ANDROID_UPLOAD_KEY_PASSWORD`

서명 artifact를 만들고 별도로 검증한 뒤 `release/readiness.json`의 `artifacts.googlePlaySignedAab`에 repo-relative path, SHA-256, 검증 시각, evidence를 기록한다. 파일 또는 hash가 달라지면 `check:release`가 다시 차단한다.

## 확정된 내용

- 앱 유형: app
- 한국어 앱 이름: 사이클 페어 : 친구/연인과 함께 컨디션을 공유해요.
- 영어 앱 이름: Cycle Pair
- package name: com.seorilabs.cyclepair
- 기본 locale: ko-KR
- 카테고리 후보: Health & Fitness
- 광고: 없음
- 실시간 채팅과 공개 커뮤니티: 없음
- 파트너에게 선택적으로 공유할 수 있는 메모·공동 일정이 UGC 정책상 어떻게 분류되는지는 확정 필요
- 가임기·피임 표시: 없음
- 수익화: 인앱 구독 후보
- 고객지원 이메일: cs@seorilabs.com
- 최초 테스트 트랙: internal

## Data safety 초안

실제 SDK와 동의 흐름을 구현한 뒤 Console 답변을 최종 확정한다.

| 데이터 | 목적 | 처리 |
| --- | --- | --- |
| 계정 식별자 | 로그인·Pair 연결 | Firebase Auth, 광고 추적 없음 |
| 생리일·증상·기분 | 앱 기능 | owner-private 저장 |
| 사용자가 선택한 projection | 사용자 요청 공유 | 정확히 한 partner에게만 제공 |
| 알림 token | 앱 기능 | 중립 알림 발송 |
| 구독 entitlement | 결제·부정 사용 방지 | 서버 영수증 검증 |
| 앱 활동 이벤트 | 분석 | 민감 값·cyclePhase 없음 |
| crash·성능 진단 | 안정성 | PII·자유 텍스트 없음 |

“수집”과 “공유”의 Play Console 정의, 사용자 시작 전송 예외, 계정 삭제 URL 요건은 실제 구현과 정책 검토 후 답한다.

## blocker

- [ ] free/paid 최초 선택
- [ ] Play Console 앱 shell
- [ ] privacy policy URL과 계정 삭제 URL
- [ ] Data safety 검토·입력
- [ ] target audience, IARC, 한국 배포·등급 판단
- [ ] 구독 product ID, 가격, 혜택
- [ ] 1024x500 feature graphic과 실제 phone screenshots
- [ ] large/xlarge 지원 기준 7-inch·10-inch tablet screenshots 각 2장 이상
- [ ] signed AAB
- [ ] production Firebase Play Integrity App Check provider 등록과 Firestore/Callable 강제 live 검증
- [ ] internal track 2인 테스트
- [ ] production access와 deployment 승인

## 준비 후 검증

~~~bash
python3 ${AGENT_HOME:-$HOME/.agent}/skills/google-play-store-registration/scripts/validate_play_store_config.py --root .
pnpm check:release
~~~

확정 필요 값이 남아 있는 현재 validator 실패는 정상이다. Console-only 정책 게이트는 API 적용 성공만으로 완료 처리하지 않는다.
