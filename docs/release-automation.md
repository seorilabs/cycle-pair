# 마켓 릴리스 자동화

## Android와 AppsInToss

- `Deploy Google Play`: 고정된 중앙 RN Google Play workflow가 exact stable SemVer
  태그 commit을 checkout하고 태그 파생 versionName/versionCode를 Gradle에 주입한다.
  명시적 `upload=true`일 때만 Google Play `internal` 트랙에 업로드한다.
  같은 tag/versionCode가 이미 동일 상태로 존재하면 재업로드하지 않고 성공으로
  수렴하며, 다른 이름이나 상태로 존재하면 drift로 중단한다.
- `Deploy AppsInToss`: AppsInToss SDK의 x86-64 Hermes compiler에 맞춰
  `ubuntu-latest`에서 `.ait`를 빌드하고 비공개 업로드한다.
- 두 workflow 모두 `workflow_dispatch`와 `workflow_call`을 제공하며 Backoffice의
  앱별 릴리스 배포 버튼에서 호출할 수 있다.
- 마켓 artifact는 exact stable `vX.Y.Z` 태그에서만 만들며 package 파일과 실행 번호는
  release version authority가 아니다.
- production 승격, 심사 제출, 공개 출시는 이 자동화에 포함하지 않는다.

중앙 계약은 `major * 1,000,000 + minor * 1,000 + patch`를 encoded version으로
계산하고 Android에는 `1,000,000,000 + encoded version`을 주입한다.

Android 서명 키와 Firebase 설정은 로컬 자격증명 카탈로그가 source of truth다.
Cloud Build에는 `seorilabs-ci` Secret Manager의 Cycle Pair 전용 실행 복제본만
환경변수로 주입하며, 저장소·소스 업로드·GitHub artifact에는 포함하지 않는다.

## App Store

App Store Archive와 TestFlight 배포는 Xcode Cloud에서 수행한다. GitHub
Actions는 macOS runner를 사용하지 않고 App Store Connect API로
`Cycle Pair Release` workflow를 호출한다.

- product: `D071BF40-979E-4D7D-A7C5-2202072488D5`
- workflow: `6310D1DD-4A04-4E5C-8B17-B86D7A744D09`
- repository: `seorilabs/cycle-pair`
- workspace: `apps/mobile/ios/CyclePair.xcworkspace`
- scheme: `CyclePair`
- trigger: 수동 `v*` tag
- Archive audience: `APP_STORE_ELIGIBLE`
- signing: Team `HCDUXX4Z3X`, automatic

`apps/mobile/ios/ci_scripts/ci_post_clone.sh`가 Node, pnpm, Firebase 설정,
CocoaPods를 준비한다. 단일 prod `GoogleService-Info.plist`는 저장소에
커밋하지 않고 Xcode Cloud secret에서 복원한다.

`apps/mobile/ios/ci_scripts/ci_pre_xcodebuild.sh`는 checksum을 검증한 중앙 helper로
`CI_TAG`의 marketing version과 deterministic build number를 반영한다.

GitHub environment `app-store`에는 다음 secret이 필요하다.

- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`

`Deploy App Store via Xcode Cloud`의 기본값은 검증 전용이다.
`upload_to_testflight=true`를 명시해야 실제 Xcode Cloud build run을 만든다.

## 현재 검증 경계

- Android global Cloud Build `c6d005cc-430c-4d1c-a8d3-54447d5cf26c`: 성공
  - 전체 12분 35초, Gradle release 7분 3초
  - v1.0.1/1000001, package `com.seorilabs.cyclepair`, min SDK 24, target/compile SDK 36
  - `arm64-v8a`, `armeabi-v7a`, upload certificate SHA-256 일치
  - `bundletool validate`와 trusted `jarsigner -verify -strict` 통과
  - Google Play 업로드·심사 제출·production 승격: 미수행
- Xcode Cloud 제품·저장소·workflow API 구성: 완료
- `main` 자동 build 제거와 수동 `v*` trigger: 완료
- Cycle Pair product 첫 build 1: post-clone 실패
  - Firebase secret 복원까지 성공
  - Xcode Cloud 기본 Ruby 2.6에 lockfile Bundler 4.0.6이 없어 중단
- Cycle Pair product build 2: post-clone 실패
  - Homebrew Ruby 3.2와 Bundler 4.0.6 설치까지 성공
  - Intel image에서 `json 2.21.0`의 Ruby C API probe 오판으로 중단
  - fallback 재선언이 없는 `json 2.7.6`으로 lockfile 고정
- Cycle Pair product build 3: post-clone 실패
  - `json 2.7.6` 설치와 전체 `bundle install` 성공
  - Archive의 `ARCHS=arm64`가 Intel Ruby native gem에 섞여
    `bigdecimal`이 잘못된 arm64 binary로 생성됨
  - Ruby host CPU별 bundle path로 native gem cache 분리
- Cycle Pair product build 4: post-clone 실패
  - host CPU별 path는 적용됐으나 `ARCHFLAGS`를 Ruby `mkmf`가 사용하지 않음
  - `arch`로 Bundler·CocoaPods 프로세스와 자식 컴파일러 아키텍처를 통일
- Cycle Pair product build 5: post-clone 실패
  - `arch` 실행만으로 `mkmf`의 Makefile `ARCH_FLAG`가 바뀌지 않음
  - `CONFIGURE_ARGS --with-arch_flag`로 native extension compile·link target 고정
  - 잘못 생성된 이전 cache와 겹치지 않는 bundle path 사용
- 새 hook 로컬 재현: `pod install` 성공, 코드 서명 없는 Release iphoneos
  `BUILD SUCCEEDED`
- Xcode Cloud secret `FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64`: 등록
- 이 변경 반영 후 첫 정상 Archive/TestFlight 실행: 미수행
- App Store 심사 제출: 미수행

이전 workflow `6744C7CB-5243-4AF0-B6B1-1DF791F38A04`는 Cycle Pair 앱이
아니라 Lucid Slotmachine product에 잘못 생성돼 build 19가 clone 단계에서
실패했다. Backoffice는 bundle ID로 product를 찾은 뒤 요청 repository와
workflow repository가 정확히 일치하는 `APP_STORE_ELIGIBLE` iOS Archive만
선택하고, 모호하면 실행하지 않는다.
