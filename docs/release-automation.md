# 마켓 릴리스 자동화

## App Store

App Store Archive와 TestFlight 배포는 Xcode Cloud에서 수행한다. GitHub
Actions는 macOS runner를 사용하지 않고 App Store Connect API로
`Cycle Pair Release` workflow를 호출한다.

- product: `AC5DE27F-26A6-4833-B98C-E85DA18BDC11`
- workflow: `EAA06E52-88D1-4172-A29B-E2B4EA2B03BB`
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
- 첫 build 14: 실패
  - 원인: 당시 `origin/main`에 `ci_scripts`가 없어 `pod install` 미실행
  - 결과: Pods xcconfig와 file list 누락
- 새 hook 로컬 재현: `pod install` 성공, 코드 서명 없는 Release iphoneos
  `BUILD SUCCEEDED`
- Xcode Cloud secret `FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64`: 미등록
- 이 변경 반영 후 첫 정상 Archive/TestFlight 실행: 미수행
- App Store 심사 제출: 미수행

CyclePair 제품에 `Lizard Tycoon TestFlight` workflow도 연결돼 있다. 다른 앱
workflow이므로 이번 변경에서는 수정하거나 삭제하지 않았다.
