# Cycle Pair Mobile

Google Play과 App Store용 React Native 0.86 앱이다. 모든 빌드는 단일 Firebase 프로젝트 `seorilabs-cyclepair-prod`를 사용하며, 한국어 출시 이름은 `사이클 페어 : 친구/연인과 함께 컨디션을 공유해요.`, 영어 출시 이름은 `Cycle Pair`, 영구 package/bundle ID는 `com.seorilabs.cyclepair`다.

## 구현 흐름

- 온보딩 → owner-private 기본 설정 → 혼자 기록 시작
- 선택적으로 파트너 탭에서 2인 Pair 초대·수락 → Pair별 공유 설정
- 오늘 홈 → 컨디션 기록 → 예상 범위 → 파트너 상태·케어 힌트
- 주기 캘린더 → 공유/중립 알림/연결 해제 설정
- iOS·Android 제품 브랜딩 시작 화면

debug와 release 모두 `com.seorilabs.cyclepair`와 같은 Firebase 프로젝트를 사용한다. 빌드 유형은 서명과 App Check provider만 구분하며 별도 dev 데이터 환경을 만들지 않는다.

민감한 역할·동의·주기·공유 설정은 AsyncStorage에 저장하지 않는다. Firebase Auth 세션을 기준으로 owner-private `privateCycles/current`와 Pair별 `shareSettings`에서 복원하며, 로컬에는 온보딩 완료 여부와 중립 알림 선호만 남긴다. Firestore native persistence도 암호화 캐시 설계 전까지 비활성화한다.

## 환경

- Node.js 24.15.x, pnpm 11.3.x
- Android local debug: JDK 17 (`jenv` + Gradle Daemon JVM criteria)
- iOS: Xcode, Ruby 3.2, Bundler/CocoaPods
- Firebase Functions 배포 런타임은 별도로 Node.js 22

RNFirebase의 privacy-first native 기본값은 루트 `firebase.json`과 `apps/mobile/firebase.json`의 `react-native` 항목에 동일하게 유지한다. iOS RNFirebase build phase는 monorepo 루트까지 탐색하지 않으므로 mobile-local 파일이 실제 빌드 입력이며, Android도 같은 파일을 사용한다. 전역 자동 데이터 수집, Analytics·Crashlytics 수집과 Messaging 자동 초기화는 사용자의 동의·앱 초기화 코드가 명시적으로 켜기 전까지 모두 꺼져 있다. App Check token refresh만 backend 보호를 위해 별도로 켜며 Analytics 동의 상태와 결합하지 않는다.

## Firebase 프로젝트

`firebase-environments.json`이 단일 project ID와 native config 경로의 source of truth다. 실제 Firebase client config는 git에 넣지 않는다.

| 빌드 | Firebase project | Android config | iOS config |
| --- | --- | --- | --- |
| Debug | `seorilabs-cyclepair-prod` | `android/app/src/main/google-services.json` | `ios/Firebase/GoogleService-Info.plist` |
| Release | `seorilabs-cyclepair-prod` | `android/app/src/main/google-services.json` | `ios/Firebase/GoogleService-Info.plist` |

각 경로의 `.example` 파일에서 확장자만 제거한 위치에 Firebase Console에서 받은 원본을 둔다. Android app root와 debug/release source set, iOS target root와 Debug/Release 하위 경로는 fallback 또는 환경 분리를 다시 만들 수 있어 허용하지 않는다.

두 빌드가 다른 Firebase project를 가리키거나 legacy dev/release config가 남아 있으면 native config gate가 실패한다.

## 게스트 인증

`새 게스트로 시작`은 Firebase 네이티브 익명 provider를 직접 호출하지 않는다. 앱이 Seorilabs Platform의 `POST /v1/auth/firebase-custom-token`에서 Firebase Custom Token을 받은 뒤 RNFirebase `signInWithCustomToken`으로 교환한다. 플랫폼이 발급한 `pb_` UID와 이메일이 없는 계정은 게스트로 취급하며, 이메일 연결 뒤에는 같은 UID의 복구 가능한 계정으로 전환한다.

## App Check

앱 entry point는 Firebase 기반 화면을 렌더링하기 전에 App Check를 초기화하고 실패 시 backend 접근을 열지 않는다. 두 빌드 모두 단일 project ID를 검증한다. Debug bundle은 debug provider, Release bundle은 Android Play Integrity와 iOS App Attest(DeviceCheck fallback)를 사용한다. debug token은 코드·설정 파일에 넣지 않고 Firebase Console에만 등록한다.

iOS는 App Check provider factory를 `FirebaseApp.configure()`보다 먼저 설치하며, App Attest entitlement는 Debug `development`, Release `production`으로 분리한다. 이 클라이언트 구현은 운영 콘솔 등록이나 강제를 증명하지 않는다. 출시 전 production project에서 Play Integrity/App Attest provider 등록, Firestore enforcement, `ENFORCE_APP_CHECK=true`로 배포된 Callable Functions를 각각 live 확인해야 한다.

## 명령

루트에서 실행한다.

```bash
pnpm install
pnpm check:mobile
pnpm start:mobile
pnpm ios
pnpm android
```

RNFirebase 설정 drift는 다음 명령으로 확인한다.

```bash
pnpm check:native-firebase-config
node scripts/check-native-firebase-config.mjs --require-config
```

첫 명령은 tracked 선택 구조와 현재 존재하는 local config를 검증하고, 두 번째 명령은 Android/iOS 단일 config가 모두 준비됐는지 강제한다.

iOS를 빌드한 뒤에는 build product의 `Info.plist`까지 검증할 수 있다.

```bash
node scripts/check-native-firebase-config.mjs \
  --built-plist /absolute/path/to/CyclePair.app/Info.plist
```

iOS 최초 준비:

```bash
cd apps/mobile
bundle install
cd ios
bundle exec pod install
```

RNFirebase 25.1.0과 React Native 0.86 prebuilt RNCore의 iOS 호환 경계는 `Podfile`의 `pre_install`에서 RNFB Pod만 static library로 연결해 해결한다. 패키지 소스나 `node_modules` patch는 사용하지 않는다. 상위 버전에서 static framework 호환이 해결되면 [ADR-0003](../../docs/adr/0003-rnfirebase-rn086-ios-compatibility.md)에 따라 hook 제거를 clean build로 검증한다.

Android Java 선택:

- `android/.java-version`은 `jenv`에서 프로젝트별 JDK 17을 선택한다.
- `android/gradle/gradle-daemon-jvm.properties`는 셸이나 IDE의 기본 Java와 무관하게 Gradle Daemon을 JDK 17로 실행한다.
- 새 macOS 개발 환경에서는 아래 작업을 한 번 수행한다.

```bash
brew install jenv
```

`~/.zshrc`에 다음을 추가한다.

```bash
export PATH="$HOME/.jenv/bin:$PATH"
eval "$(jenv init -)"
```

새 로그인 셸에서 기존 JDK를 등록하고 `JAVA_HOME` 연동을 켠다.

```bash
exec zsh -l
jenv add "$(/usr/libexec/java_home -v 17)"
jenv enable-plugin export
exec zsh -l
```

임시 전환은 `jenv shell 21`, 해제는 `jenv shell --unset`, 등록된 버전 확인은 `jenv versions`를 사용한다.

Android local debug build:

```bash
cd apps/mobile/android
./gradlew :app:verifyDebugFirebaseConfig
./gradlew assembleDebug
```

Release Firebase gate는 upload key 없이 독립적으로 확인할 수 있다.

```bash
cd apps/mobile/android
./gradlew :app:verifyReleaseFirebaseConfig
./gradlew :app:verifyReleasePrerequisites
```

두 번째 명령은 production Firebase와 upload signing 누락을 한 번에 모두 열거한다.

Debug keystore로 만든 산출물은 배포용이 아니다. 실제 AAB/archive, release signing, 마켓 업로드는 deployment approval 이후 별도 release gate에서 처리한다.
