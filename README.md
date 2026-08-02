# 사이클 페어

생리주기와 컨디션을 원하는 만큼만 공유하고, 두 사람이 함께 대비하도록 돕는 커뮤니케이션 앱입니다. 의료 진단·치료 또는 피임 도구가 아닙니다.

## 현재 구현 단계

- 제품 단계: 혼자 기록·관리하고 선택적으로 Pair를 연결하는 MVP를 구현한 내부 alpha/closed beta 후보
- `apps/mobile`: Google Play·App Store용 React Native 앱. 인증, 기록·달력, Pair, 공동 일정, 암호화 오프라인 큐, 계정 설정을 연결
- `packages/product-core`: 플랫폼 독립 도메인·유스케이스·포트
- `firebase`: owner-private 데이터와 파트너 공유 projection을 분리한 Rules·Functions 백엔드
- `apps/ait`: AppsInToss SDK 2.x 기반의 로컬 컨디션 선택·명시적 공유 타깃. 전체 계정·Firebase·구독 연동은 정책 검토 후 확장

한국어 출시 표시 이름은 `사이클 페어 : 친구/연인과 함께 컨디션을 공유해요.`, 영어 출시 표시 이름은 `Cycle Pair`입니다. 앱 내부와 알림에서는 짧은 한국어 브랜드 `사이클 페어`를 사용합니다. Android application ID와 iOS bundle ID는 모두 `com.seorilabs.cyclepair`입니다. AppsInToss 빌드는 임시 `appName` 후보 `cycle-pair`를 사용하며, 콘솔 가용성 확인 후 같은 값으로 영구 등록해야 합니다.

개발 환경은 민감정보 격리를 위해 별도 Firebase 프로젝트 `seorilabs-cyclepair-dev`, Functions/Firestore 리전 `asia-northeast3`를 사용합니다. 앱 설치 식별자는 개발·출시 빌드 모두 영구 ID를 사용하고, 환경 경계는 Firebase 프로젝트와 빌드 설정으로 분리합니다.

현재 상태는 production-ready가 아닙니다. App Check 클라이언트 경로는 구현됐지만 운영 Firebase 프로젝트의 provider 등록·Firestore/Callable 강제는 검증되지 않았습니다. 이 밖에도 마켓 서명/콘솔 메타데이터, APNs·FCM 실기기 수신, sandbox 구독, 2인 실기기 회귀 QA와 deployment approval이 남아 있습니다. 구현·검증 근거와 남은 gate는 `docs/implementation-completion.md`와 `docs/qa.md`를 source of truth로 사용합니다.

## 로컬 명령

```bash
pnpm install
pnpm test:core
pnpm check:architecture
pnpm check:mobile
pnpm check:ait
pnpm check:firebase
pnpm build:google-play
pnpm build:ait
pnpm start:mobile
pnpm start:ait
```

네이티브 Firebase 설정 파일은 로컬에만 설치되고 git에서 제외됩니다. Firebase Emulator, 실제 개발 프로젝트 상태, 각 마켓 준비 절차는 `docs/qa.md` 및 마켓별 폴더를 참고합니다.
