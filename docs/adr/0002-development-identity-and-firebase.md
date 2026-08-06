# ADR-0002: 개발 식별자와 Firebase 프로젝트 격리

## 상태

Superseded by [ADR-0004](./0004-cycle-pair-identity.md) · 2026-07-13

## 배경

2026-07-12 기준 App Store와 Google Play에 `MoonMate` 이름으로 주기·기분 기록과 파트너 공유를 제공하는 앱이 이미 출시돼 있다.

- App Store: https://apps.apple.com/app/id6754920937
- Google Play: https://play.google.com/store/apps/details?id=app.moonmate

현재 이름과 핵심 기능이 모두 겹치므로 이 이름을 출시 식별자로 영구 고정하면 스토어 중복, 상표, 검색 혼동 위험이 크다. 한편 실제 Auth·Firestore·Functions 통합은 출시명 결정과 분리해 검증할 수 있다.

## 결정

- `MoonMate`와 `moonmate`는 저장소·개발 환경의 내부 코드명으로만 사용한다.
- 출시 이름, Android package name, iOS bundle ID, AppsInToss `appName`은 새 이름 검토 전까지 `확정 필요`로 유지한다.
- 개발 앱은 `com.seorilabs.moonmate.dev`를 사용한다.
- 민감 건강정보, Auth 사용자, Security Rules, 비용과 운영 경계를 다른 앱과 섞지 않기 위해 별도 Firebase 개발 프로젝트 `seorilabs-moonmate-dev`를 사용한다.
- Firestore와 Functions 리전은 `asia-northeast3`를 사용한다.
- 익명 인증은 2인 연결 검증용 개발 전략일 뿐 운영 로그인 제공자 결정이 아니다.
- 민감 projection의 일반 디스크 캐시를 피하기 위해 Firestore native persistence를 끈다. 암호화 캐시는 별도 설계 후 도입한다.
- `google-services.json`과 `GoogleService-Info.plist`는 로컬 또는 CI secret injection으로 공급하고 git에는 넣지 않는다.

## 결과

- 출시명 변경 없이 실제 모바일↔Firebase 어댑터를 검증할 수 있다.
- Firebase 개발 프로젝트는 이후 폐기하거나 새 출시 식별자의 운영 프로젝트와 명확히 분리할 수 있다.
- 2026-07-12 개발 프로젝트에 결제를 연결하고 Functions 7개와 실제 익명 계정 2개의 backend lifecycle을 검증했다. 이는 운영 프로젝트·로그인·App Check 또는 스토어 배포 승인을 의미하지 않는다.

2026-07-13 출시 이름과 영구 앱 ID가 확정되면서 이 ADR의 임시 이름·식별자 결정은 ADR-0004로 대체됐다. `seorilabs-moonmate-dev`는 데이터 이전 없이 2026-08-06 프로젝트 삭제를 요청했고 `DELETE_REQUESTED`로 확인했다. 위 내용은 초기 개발 환경의 역사적 기록으로만 보존한다.
