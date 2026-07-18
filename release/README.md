# Release evidence

`readiness.json`은 생성된 파일이 있다는 주장과 실제 Console·정책·수동 QA 완료 근거를 분리하는 repo-local inventory다. `scripts/check-release.mjs`는 이 파일과 각 마켓 config, Firebase deployment evidence를 함께 읽어 blocker가 하나도 없을 때만 `ready: true`를 반환한다.

## Evidence 규칙

- `targetMarkets`는 현재 release candidate의 실제 대상이다. 마켓 제외는 `included: false`만으로 처리하지 않고 결정 시각과 근거가 있는 `verified` evidence를 요구한다. 현재 MVP 대상은 Google Play와 App Store이며 AppsInToss는 명시적으로 제외했다.
- 미완료 항목은 `status: "missing"`으로 유지한다.
- 완료 항목은 실제 확인 후에만 `status: "verified"`, ISO 8601 `verifiedAt`, 재확인 가능한 `evidence`를 함께 기록한다.
- 정책상 적용되지 않는 항목만 `status: "not-applicable"`과 판단 근거를 기록할 수 있다. Deployment approval과 실제 배포·수동 테스트에는 사용할 수 없다.
- AAB, App Store archive export, `.ait` 같은 artifact는 repo-relative `path`와 파일의 SHA-256도 기록한다. AAB는 central directory를 직접 파싱해 `BundleConfig.pb`, protobuf base manifest, DEX magic과 모든 payload의 JAR manifest 포함 여부를 확인한 뒤 `jarsigner`와 `keytool`로 실제 signature·certificate SHA-256을 검증한다. App Store archive는 traversal·symlink가 없는 `.xcarchive.zip`만 임시 디렉터리에 풀고 실제 app/archive plist의 bundle·version·Team ID와 Apple signing identity를 macOS `plutil`·`codesign --verify --deep --strict`로 검증한다. self-declared boolean, raw filename 문자열, plain text 파일은 hash가 맞아도 통과하지 않는다.
- `verified`는 배포·제출 권한을 만들지 않는다. `approvals.deployment`는 사용자가 별도로 승인하고 그 근거를 기록한 경우에만 완료한다.

Firebase는 [Firebase release-readiness](../firebase/release-readiness.json)의 개발·운영 배포 evidence가 각각 현재 deployment fingerprint와 같아야 한다. v3 fingerprint에는 canonical Firestore/Functions deploy config, Rules, indexes, Functions source와 `firebase` workspace package·lock·workspace 설정이 포함된다. 배포 evidence의 Git SHA는 형식만이 아니라 현재 repo에 존재하는 HEAD ancestor commit이어야 하며 그 commit과 현재 deployment source가 같아야 한다. project ID, region, RFC 3339 `deployedAt`도 검증한다. 운영 project는 개발과 분리된 ID, `.firebaserc` alias, Android/iOS Release native config, native 앱 등록 evidence까지 일치해야 한다. 이전 live audit가 있어도 배포 입력이 바뀌거나 운영 evidence가 빠지면 `stale` 또는 blocker다.
