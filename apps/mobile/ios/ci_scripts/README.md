# Xcode Cloud release hooks

Cycle Pair iOS Archive와 TestFlight 배포는 GitHub macOS runner가 아니라
Xcode Cloud에서 실행한다.

- Product: `D071BF40-979E-4D7D-A7C5-2202072488D5`
- Workflow: `Cycle Pair Release`
- Workflow ID: `6310D1DD-4A04-4E5C-8B17-B86D7A744D09`
- Trigger: 수동 `v*` tag
- Action: `CyclePair` Release Archive, `APP_STORE_ELIGIBLE`
- Signing: Team `HCDUXX4Z3X`, automatic

`ci_post_clone.sh`는 Node, pnpm, workspace와 CocoaPods를 준비한다. 운영
`GoogleService-Info.plist`는 Xcode Cloud secret
`FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64`에서만 복원한다. 실제 plist와
API key는 저장소에 커밋하지 않는다.

`Gemfile.lock`의 `BUNDLED WITH` 버전이 요구하는 Ruby가 Xcode Cloud
기본 Ruby보다 새로우면 `ruby@3.2`를 설치한 뒤 동일 Bundler 버전으로
Pods를 설치한다.

`ci_pre_xcodebuild.sh`는 exact `CI_TAG`를 중앙 release authority helper에 전달해
marketing version과 deterministic build number를 반영한다.

로컬 version hook 점검:

```sh
CI_TAG=v1.2.3 CI_PRE_XCODEBUILD_DRY_RUN=1 \
  sh apps/mobile/ios/ci_scripts/ci_pre_xcodebuild.sh
```
