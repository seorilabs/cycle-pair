# ADR-0003: React Native 0.86과 RNFirebase 25.1 iOS 호환

- 상태: 채택
- 날짜: 2026-07-12
- 갱신: 2026-07-14

## 맥락

React Native 0.86은 iOS prebuilt RNCore를 기본 사용한다. RNFirebase 25.1.0의 App, Auth, Firestore, Functions Pod는 `use_frameworks! :linkage => :static` 조합에서 prebuilt RNCore dependency와 React header module 경계를 완전히 연결하지 않아 Firestore의 `RCTPromiseRejectBlock`, `RCTBridgeModule` 컴파일 오류가 발생한다.

- RNFirebase maintainer workaround: https://github.com/invertase/react-native-firebase/issues/8883

## 결정

- React Native prebuilt RNCore와 New Architecture를 유지한다.
- 전체 CocoaPods graph의 static framework linkage는 유지한다.
- `Podfile`의 `pre_install` hook에서 이름이 `RNFB`로 시작하는 Pod만 `Pod::BuildType.static_library`로 강제한다.
- RNFirebase 패키지 소스, `node_modules`, pnpm `patchedDependencies`는 수정하지 않는다.
- Analytics는 AdSupport 없이 연결해 IDFA 접근 경로를 포함하지 않는다.

초기 진단 과정에서 upstream producer-side patch 네 개를 검토했지만, 유지보수 가능한 공식 workaround로 clean build가 통과해 최종안에서는 제거했다.

## 검증과 제거 조건

Xcode 26.5 simulator SDK에서 generic iOS Simulator arm64 Debug를 새 DerivedData로 `clean build`해 검증했다. RNFB target은 `libRNFB*.a`와 `MACH_O_TYPE=staticlib`로 생성되고, 앱 전체 빌드와 built Firebase privacy config 검사가 통과했다.

RNFirebase 상위 버전에서 RN 0.86 prebuilt RNCore와 static framework 조합이 직접 지원되면 hook을 제거한 뒤 `pod install --deployment`와 새 DerivedData full build를 다시 수행한다.
