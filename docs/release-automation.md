# 네이티브 릴리스 실행

현재 caller는 `deploy-google-play.yml`과 `deploy-app-store.yml`입니다. 둘 다 최신 중앙 RN 재사용 workflow를 호출합니다. 과거 Xcode Cloud 설정과 실행 기록은 아래에 보존하며 현재 경로와 구분합니다.

- Google Play는 `release_tag`, `upload`, `release_status`를 받습니다. 테스트 배포는 `upload=true`, `release_status=completed`를 명시해 internal 트랙의 정확한 빌드를 다시 읽습니다.
- App Store는 `release_tag`와 `upload`를 받으며 중앙 macOS 빌드에서 archive와 App Store Connect 업로드를 수행합니다. Xcode Cloud를 호출하는 workflow가 아닙니다.
- AppsInToss caller와 전용 앱은 제거했습니다. 외부 콘솔 등록은 보존합니다.
- main의 CI 성공은 마켓 업로드가 아닙니다. exact stable 태그, 중앙 버전 원장과 receipt를 확인한 뒤 후보 번호를 확정합니다. package 파일의 개발 기본값을 출시 번호의 정본으로 사용하지 않습니다.
- 로컬 카탈로그의 기존 앱별 서명과 Firebase identity를 재사용합니다. 비밀값은 로그, 저장소와 artifact에 포함하지 않습니다.

## 단계별 검사

```sh
pnpm check:release --target google-play --phase before-build --evidence <실제실행.json> --authority <최신중앙checkout>
pnpm check:release --target google-play --phase before-deploy --evidence <실제실행.json> --authority <최신중앙checkout>
pnpm check:release --target google-play --phase before-release --evidence <실제실행.json> --authority <최신중앙checkout>
```

App Store에서는 `--target app-store`로 실행합니다. 빌드 전에는 서명 산출물을 요구하지 않으며 업로드 전부터 정확한 서명 파일과 해시를 확인합니다. 제출 전에는 운영 연결, 정책과 저장된 마켓 문구를 검수합니다. 모든 단계는 승인 계획의 실제 실행 근거를 최신 중앙 검증기로 검사합니다. 미실행을 통과로 바꾸지 않습니다.

승인된 끝 지점은 두 마켓 공개입니다. 업로드와 처리 완료, 심사 접수, 승인, 공개 페이지와 버전 확인을 각각 기록합니다. [현재 설계](design/2026-10-22-native-launch/design.md)와 실제 caller 입력이 실행 기준입니다.

## 과거 실행 기록

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
