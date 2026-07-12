# ADR-0003: React Native 0.86과 RNFirebase 25.1 iOS 호환

- 상태: 임시 채택
- 날짜: 2026-07-12

## 맥락

React Native 0.86은 iOS prebuilt RNCore를 기본 사용한다. RNFirebase 25.1.0의 App, Auth, Firestore, Functions Pod는 `use_frameworks! :linkage => :static` 조합에서 prebuilt RNCore dependency와 React header module 경계를 완전히 연결하지 않아 Firestore의 `RCTPromiseRejectBlock`, `RCTBridgeModule` 컴파일 오류가 발생한다.

- upstream: https://github.com/invertase/react-native-firebase/pull/9024
- 적용 기준 SHA: `dbb11cda4133d11728b705e3d6bc0197a6d49176`
- React Native consumer-side fix: https://github.com/facebook/react-native/pull/56862

## 결정

- React Native prebuilt RNCore와 New Architecture를 유지한다.
- RNFirebase 공식 설정인 static framework linkage를 유지한다.
- 사용 중인 `@react-native-firebase/app`, `auth`, `firestore`, `functions` 25.1.0에 upstream PR #9024의 producer-side 변경만 `pnpm patchedDependencies`로 적용한다.
- 패치는 `add_rncore_dependency`, non-modular include 허용, 필요한 React header import order를 포함한다.

## 검증과 제거 조건

Xcode 26.5 simulator SDK에서 iPhone 16 Pro arm64 Debug build를 clean DerivedData로 검증한다. PR #9024는 아직 정식 릴리스가 아니므로 임시 patch로만 취급한다. RNFirebase 정식 릴리스에 PR #9024 또는 동등한 수정이 포함되면 patch 네 개와 `patchedDependencies` 항목을 제거하고 clean pod install/build를 다시 수행한다.
