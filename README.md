# Cycle Pair

생리주기와 컨디션을 원하는 만큼만 공유하고, 두 사람이 함께 대비하도록 돕는 커뮤니케이션 앱입니다. 의료 진단·치료 또는 피임 도구가 아닙니다.

## 현재 구현 단계

- 제품 단계: 혼자 기록·관리하고 선택적으로 Pair를 연결하는 MVP를 구현한 내부 alpha/closed beta 후보
- `apps/mobile`: Google Play·App Store용 React Native 앱. 인증, 기록·달력, Pair, 공동 일정, 암호화 오프라인 큐, 계정 설정을 연결
- `packages/product-core`: 플랫폼 독립 도메인·유스케이스·포트
- `firebase`: owner-private 데이터와 파트너 공유 projection을 분리한 Rules·Functions 백엔드
- `apps/ait`: AppsInToss 정책 적합성과 영구 `appName` 확정 후 생성

출시 표시 이름은 `Cycle Pair`, Android application ID와 iOS bundle ID는 모두 `com.seorilabs.cyclepair`입니다. AppsInToss 영구 `appName`은 콘솔 가용성과 정책 적합성 확인 전까지 `확정 필요`로 유지합니다.

개발 환경은 민감정보 격리를 위해 별도 Firebase 프로젝트 `seorilabs-cyclepair-dev`, Functions/Firestore 리전 `asia-northeast3`를 사용합니다. 앱 설치 식별자는 개발·출시 빌드 모두 영구 ID를 사용하고, 환경 경계는 Firebase 프로젝트와 빌드 설정으로 분리합니다.

현재 상태는 production-ready가 아닙니다. App Check 클라이언트 경로는 구현됐지만 운영 Firebase 프로젝트의 provider 등록·Firestore/Callable 강제는 검증되지 않았습니다. 이 밖에도 마켓 서명/콘솔 메타데이터, APNs·FCM 실기기 수신, sandbox 구독, 2인 실기기 회귀 QA와 deployment approval이 남아 있습니다. 구현·검증 근거와 남은 gate는 `docs/implementation-completion.md`와 `docs/qa.md`를 source of truth로 사용합니다.

## 로컬 명령

```bash
pnpm install
pnpm test:core
pnpm check:architecture
pnpm check:mobile
pnpm check:firebase
pnpm start:mobile
```

네이티브 Firebase 설정 파일은 로컬에만 설치되고 git에서 제외됩니다. Firebase Emulator, 실제 개발 프로젝트 상태, 각 마켓 준비 절차는 `docs/qa.md` 및 마켓별 폴더를 참고합니다.
