# 마켓 릴리스 자동화

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
CocoaPods를 준비한다. production `GoogleService-Info.plist`는 저장소에
커밋하지 않고 Xcode Cloud secret에서 복원한다.

`apps/mobile/ios/ci_scripts/ci_pre_xcodebuild.sh`는 `CI_TAG`와
`CI_BUILD_NUMBER`를 앱 버전에 반영한다.

GitHub environment `app-store`에는 다음 secret이 필요하다.

- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`

`Deploy App Store via Xcode Cloud`의 기본값은 검증 전용이다.
`upload_to_testflight=true`를 명시해야 실제 Xcode Cloud build run을 만든다.

## 현재 검증 경계

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
