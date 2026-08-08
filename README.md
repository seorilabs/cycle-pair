# 사이클 페어

생리주기와 컨디션을 원하는 만큼만 공유하고, 두 사람이 함께 대비하도록 돕는 커뮤니케이션 앱입니다. 의료 진단·치료 또는 피임 도구가 아닙니다.

## 현재 구현 단계

- 제품 단계: 혼자 기록·관리하고 선택적으로 Pair를 연결하는 MVP를 구현한 내부 alpha/closed beta 후보
- `apps/mobile`: Google Play·App Store용 React Native 앱. 인증, 기록·달력, Pair, 공동 일정, 암호화 오프라인 큐, 계정 설정을 연결
- `packages/product-core`: 플랫폼 독립 도메인·유스케이스·포트
- `firebase`: owner-private 데이터와 파트너 공유 projection을 분리한 Rules·Functions 백엔드
- `apps/ait`: AppsInToss SDK 2.x 기반의 로컬 컨디션 선택·명시적 공유 타깃. 전체 계정·Firebase·구독 연동은 정책 검토 후 확장

한국어 출시 표시 이름은 `사이클 페어 : 내 기분, 주기, 컨디션을 알려요`, 영어 출시 표시 이름은 `Cycle Pair`입니다. 앱 내부와 알림에서는 짧은 한국어 브랜드 `사이클 페어`를 사용합니다. Android application ID와 iOS bundle ID는 모두 `com.seorilabs.cyclepair`입니다. AppsInToss 빌드는 임시 `appName` 후보 `cycle-pair`를 사용하며, 콘솔 가용성 확인 후 같은 값으로 영구 등록해야 합니다.

Debug와 Release는 모두 단일 Firebase 프로젝트 `seorilabs-cyclepair-prod`를 사용합니다. Cloud Functions는 `asia-northeast3`, 기존 Firestore `(default)` 데이터베이스는 변경할 수 없는 `nam5` 멀티 리전에 있습니다. 게스트 인증은 앱이 Firebase Anonymous Auth를 직접 호출하지 않고 Seorilabs Platform이 발급한 `pb_` UID의 Firebase Custom Token을 교환합니다.

2026-08-06에 legacy `seorilabs-cyclepair-dev`, `seorilabs-moonmate-dev`는 데이터 이전 없이 프로젝트 삭제를 요청했고 둘 다 `DELETE_REQUESTED`로 확인했습니다. 복구하지 않으며 실제 앱·배포·운영 점검은 prod 프로젝트만 대상으로 합니다.

현재 상태는 production-ready가 아닙니다. App Check 클라이언트와 운영 provider 설정은 존재하지만 Firestore·Auth는 monitoring-only이고 Callable 강제도 꺼져 있습니다. Android Play Integrity에 필요한 Play app-signing SHA-256 등록과 실기기 token 검증 전에는 강제하지 않습니다. 이 밖에도 마켓 서명/콘솔 메타데이터, APNs·FCM 실기기 수신, sandbox 구독, 2인 실기기 회귀 QA와 deployment approval이 남아 있습니다. 구현·검증 근거와 남은 gate는 `docs/implementation-completion.md`와 `docs/qa.md`를 source of truth로 사용합니다.

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

네이티브 Firebase 설정 파일은 로컬에만 설치되고 git에서 제외됩니다. Firebase Emulator, 단일 prod 프로젝트 상태, 각 마켓 준비 절차는 `docs/qa.md` 및 마켓별 폴더를 참고합니다.
