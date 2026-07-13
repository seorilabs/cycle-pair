# Cycle Pair

생리주기와 컨디션을 원하는 만큼만 공유하고, 두 사람이 함께 대비하도록 돕는 커뮤니케이션 앱입니다. 의료 진단·치료 또는 피임 도구가 아닙니다.

## 현재 구현 단계

- `apps/mobile`: Google Play·App Store용 React Native 앱
- `packages/product-core`: 플랫폼 독립 도메인·유스케이스·포트
- `firebase`: 소유자 전용 데이터와 파트너 공유 projection을 분리한 백엔드
- `apps/ait`: AppsInToss 정책 적합성과 영구 `appName` 확정 후 생성

출시 표시 이름은 `Cycle Pair`, Android application ID와 iOS bundle ID는 모두 `com.seorilabs.cyclepair`입니다. AppsInToss 영구 `appName`은 콘솔 가용성과 정책 적합성 확인 전까지 `확정 필요`로 유지합니다.

개발 환경은 민감정보 격리를 위해 별도 Firebase 프로젝트 `seorilabs-cyclepair-dev`, Functions/Firestore 리전 `asia-northeast3`를 사용합니다. 앱 설치 식별자는 개발·출시 빌드 모두 영구 ID를 사용하고, 환경 경계는 Firebase 프로젝트와 빌드 설정으로 분리합니다. 모바일은 개발용 익명 인증, owner-private Firestore 기록, callable Pair 초대·수락·해제, 선택형 partner projection 어댑터가 연결돼 있습니다. 운영 로그인 제공자와 App Check 강제 정책은 출시 전 별도로 확정합니다.

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
