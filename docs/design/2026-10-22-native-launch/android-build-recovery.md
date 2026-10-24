# Android 빌드 경로 복구

2026-10-24 사용자의 “안드로이드 빌드 복구 하라” 지시와 버전 1.1.1 선택에 따른 후속 수정이다. 기존 [설계](design.md)와 [L3 개발 검수 계획](test-plan.json)의 출시 범위를 유지한다.

## 실패와 수정 범위

1.1.0의 Android 빌드 40089958962는 `settings.gradle`이 앱 하위 `node_modules/@react-native/gradle-plugin`을 찾다가 종료됐다. `.npmrc`의 `node-linker=hoisted`는 실제 패키지를 저장소 루트에 설치한다. 같은 오류를 깨끗한 worktree의 Gradle `help`로 재현했다.

Gradle 플러그인은 앱 디렉터리에서 Node의 `require.resolve`로 찾는다. 플러그인 관리와 composite build가 같은 경로를 사용한다. 앱의 React Native와 Codegen 경로도 기존 Hermes 경로 해석 방식으로 찾는다. CLI는 React Native Gradle Plugin의 `reactNativeDir` 기반 기본값을 사용한다. 의존성 버전과 잠금 파일, 제품 화면과 저장 형식, 서명 키는 바꾸지 않는다. 임시 심볼릭 링크는 만들지 않는다.

## 인수조건과 검증

- AC-ANDROID-1: hoisted 설치에서 Gradle 플러그인과 React Native, Codegen, CLI가 실제 패키지로 해석된다. 수정 전 Gradle 실패와 수정 후 설정 검증을 대조한다. `scripts/verify-android-node-resolution.gradle`을 init script로 주고 `:app:verifyNodePackageResolution`을 실행해 실제 Gradle 확장, 포함 빌드와 설치 파일을 검사한다. 문자열 일치 테스트로 실제 Gradle 실행을 대신하지 않는다.
- AC-ANDROID-2: 동일 수정 후보의 릴리스 코드 생성, JS와 Hermes 묶기, 네이티브 컴파일, 서명 AAB 생성을 확인한다. 산출물의 패키지와 버전, ABI, 공개 서명 지문을 읽어 검증한다.
- AC-ANDROID-3: 별도 실행자 또는 확인된 CI로 개발 환경 회귀와 필수 검사를 실행하고 로컬 코드 리뷰 후 PR로 병합한다. 기존 UI 독립 검수 3회의 원본 후보와 판정을 보존하며 새 후보 실행으로 고쳐 쓰지 않는다. 추가 화면 개편이나 기기 실행은 포함하지 않는다.

실행 기록은 실제 후보 SHA, 명령, 시각, 실패와 성공, NAS 검증 목록을 남긴다. 마켓 빌드 직전에는 최신 중앙 검증기로 개발 근거를 다시 확인한다. 1.1.0 태그는 보존하고, 수정 후보는 승인된 1.1.1 태그의 버전 할당을 사용한다. Google Play는 사용자가 지정한 계정과 대상 앱을 업로드 전에 다시 확인한다.

실패하면 해당 후보의 빌드와 업로드를 중단한다. 복구는 변경 커밋을 되돌리는 PR로 하며 기존 태그나 자격증명을 바꾸지 않는다.
