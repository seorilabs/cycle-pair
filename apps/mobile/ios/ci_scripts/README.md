# Xcode Cloud release hooks

Cycle Pair iOS Archive와 TestFlight 배포는 GitHub macOS runner가 아니라
Xcode Cloud에서 실행한다.

- Product: `AC5DE27F-26A6-4833-B98C-E85DA18BDC11`
- Workflow: `Cycle Pair Release`
- Workflow ID: `EAA06E52-88D1-4172-A29B-E2B4EA2B03BB`
- Trigger: 수동 `v*` tag
- Action: `CyclePair` Release Archive, `APP_STORE_ELIGIBLE`
- Signing: Team `HCDUXX4Z3X`, automatic

`ci_post_clone.sh`는 Node, pnpm, workspace와 CocoaPods를 준비한다. 운영
`GoogleService-Info.plist`는 Xcode Cloud secret
`FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64`에서만 복원한다. 실제 plist와
API key는 저장소에 커밋하지 않는다.

`ci_pre_xcodebuild.sh`는 `CI_TAG`와 `CI_BUILD_NUMBER`를 marketing version과
build number로 반영한다.

로컬 version hook 점검:

```sh
CI_TAG=v1.2.3 CI_BUILD_NUMBER=42 CI_PRE_XCODEBUILD_DRY_RUN=1 \
  sh apps/mobile/ios/ci_scripts/ci_pre_xcodebuild.sh
```
