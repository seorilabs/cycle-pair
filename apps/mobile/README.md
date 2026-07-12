# MoonMate Mobile

Google Play과 App Store용 React Native 0.86 앱이다. 제품 세로 슬라이스는 개발 Firebase 프로젝트에 연결돼 있으며, 출시 이름과 영구 package/bundle ID는 출시 전 `확정 필요`다.

## 구현 흐름

- 온보딩 → owner-private 주기 시드 → 2인 Pair 초대·수락 → Pair별 공유 설정
- 오늘 홈 → 컨디션 기록 → 예상 범위 → 파트너 상태·케어 힌트
- 주기 캘린더 → 공유/중립 알림/연결 해제 설정
- iOS·Android 제품 브랜딩 시작 화면

개발 식별자는 `com.seorilabs.moonmate.dev`다. 출시 식별자로 사용하지 않는다.

민감한 역할·동의·주기·공유 설정은 AsyncStorage에 저장하지 않는다. Firebase Auth 세션을 기준으로 owner-private `privateCycles/current`와 Pair별 `shareSettings`에서 복원하며, 로컬에는 온보딩 완료 여부와 중립 알림 선호만 남긴다. Firestore native persistence도 암호화 캐시 설계 전까지 비활성화한다.

## 환경

- Node.js 24.15.x, pnpm 11.3.x
- Android local debug: JDK 17
- iOS: Xcode, Ruby 3.2, Bundler/CocoaPods
- Firebase Functions 배포 런타임은 별도로 Node.js 22

## 명령

루트에서 실행한다.

```bash
pnpm install
pnpm check:mobile
pnpm start:mobile
pnpm ios
pnpm android
```

iOS 최초 준비:

```bash
cd apps/mobile
bundle install
cd ios
bundle exec pod install
```

RNFirebase 25.1.0과 React Native 0.86 prebuilt RNCore의 iOS 호환 수정은 `pnpm-workspace.yaml`의 임시 `patchedDependencies`로 고정돼 있다. 정식 상위 버전에 동일 수정이 포함되면 [ADR-0003](../../docs/adr/0003-rnfirebase-rn086-ios-compatibility.md)에 따라 제거한다.

Android local debug build:

```bash
cd apps/mobile/android
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home ./gradlew assembleDebug
```

Debug keystore와 `.dev` 식별자를 쓰는 산출물은 배포용이 아니다. 실제 AAB/archive, 서명, 마켓 업로드는 영구 ID와 deployment approval 이후 별도 release gate에서 처리한다.
