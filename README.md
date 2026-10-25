# Cycle Pair

오늘의 감정, 원하는 도움과 주기를 기록하고, 선택한 항목만 한 명의 파트너와 공유하는 앱입니다. 의료 진단, 치료나 피임에 사용할 수 없습니다.

## 출시 범위

Google Play와 App Store에서 전 세계 무료 공개를 준비합니다. 시스템 언어가 한국어이면 한국어, 그 외에는 영어로 시작하며 설정에서 바꿀 수 있습니다. IAP와 구독 처리 코드를 제거하고 기존 기록 기능을 무료로 제공합니다. 이번 출시는 광고도 표시하지 않으며 전면광고와 보상광고는 후속 계획입니다. 과거 운영 자료는 일괄 삭제하지 않습니다. AppsInToss 전용 앱과 배포는 제거했으며 외부 콘솔 등록은 변경하지 않습니다.

Android application ID와 iOS bundle ID는 `com.seorilabs.cyclepair`입니다. `apps/mobile`은 React Native 앱, `packages/product-core`는 제품 로직, `firebase`는 개인 기록과 선택 공유를 관리합니다.

실제 서비스는 `seorilabs-cyclepair-prod`를 사용합니다. Functions는 `asia-northeast3`, Firestore는 기존 `nam5`입니다. 서비스의 게스트 인증은 Seorilabs Platform의 Firebase Custom Token을 사용합니다.

현재 변경과 검증 범위는 [승인 설계](docs/design/2026-10-22-native-launch/design.md), [테스트 계획](docs/design/2026-10-22-native-launch/test-plan.json), [개발 실행 안내](docs/qa/native-development.md)를 따릅니다. 개발 빌드, 실제 서비스 실행, 마켓 업로드, 심사와 공개는 각각 확인합니다.

## 개발

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm check:architecture
```

로컬 Firebase는 별도 터미널에서 시작합니다.

```sh
pnpm start:emulators
CYCLEPAIR_DEV_BACKEND=emulator pnpm start:mobile
```

서비스 연결은 `CYCLEPAIR_DEV_BACKEND=service pnpm start:mobile`로 구분합니다. 두 연결은 각각 분리한 테스트 설치본을 사용하며 기존 계정과 오프라인 기록을 지우지 않습니다. 출시 번들은 Emulator 연결 선택을 거부합니다.

실제 Firebase 설정과 서명 자료는 등록된 자격증명에서 복원하며 저장소에 넣지 않습니다. 네이티브 빌드와 마켓 실행은 [릴리스 안내](docs/release-automation.md)를 따릅니다.

## 라이선스

이 저장소는 소스를 공개하지만 오픈소스 라이선스를 부여하지 않습니다. 모든 권리는 Seorilabs가 보유하며 열람 외의 복제·수정·재배포·2차 저작물 제작을 허용하지 않습니다. 외부 기여 PR은 받지 않습니다.
