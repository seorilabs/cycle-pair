# MoonMate (내부 코드명)

생리주기와 컨디션을 원하는 만큼만 공유하고, 두 사람이 함께 대비하도록 돕는 커뮤니케이션 앱입니다. 의료 진단·치료 또는 피임 도구가 아닙니다.

## 현재 구현 단계

- `apps/mobile`: Google Play·App Store용 React Native 앱
- `packages/product-core`: 플랫폼 독립 도메인·유스케이스·포트
- `firebase`: 소유자 전용 데이터와 파트너 공유 projection을 분리한 백엔드
- `apps/ait`: AppsInToss 정책 적합성과 영구 `appName` 확정 후 생성

`MoonMate`는 동일 카테고리·핵심 기능의 선출시 앱이 확인되어 내부 코드명으로만 사용합니다. 출시 이름, Android package name, iOS bundle ID, AppsInToss `appName`은 `확정 필요`입니다.

개발 환경은 민감정보 격리를 위해 별도 Firebase 프로젝트 `seorilabs-moonmate-dev`, Android/iOS 식별자 `com.seorilabs.moonmate.dev`, Functions/Firestore 리전 `asia-northeast3`를 사용합니다. 모바일은 개발용 익명 인증, owner-private Firestore 기록, callable Pair 초대·수락·해제, 선택형 partner projection 어댑터가 연결돼 있습니다. 운영 로그인 제공자와 App Check 강제 정책은 출시 전 별도로 확정합니다.

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
