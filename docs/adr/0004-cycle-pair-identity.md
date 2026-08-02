# ADR-0004: 사이클 페어 영구 앱 식별자와 개발 Firebase 전환

## 상태

Accepted · 2026-07-13

## 배경

초기 코드명 `MoonMate`는 같은 Health & Fitness 카테고리에서 주기·기분 기록과 파트너 공유를 제공하는 동명 앱이 이미 출시돼 있어 공개 이름으로 사용할 수 없었다. 임시 Android/iOS 식별자 `com.seorilabs.moonmate.dev`와 Firebase 프로젝트 `seorilabs-moonmate-dev`는 출시 이름 결정 전 실제 백엔드 경계를 검증하기 위한 값이었다.

## 결정

- 공개 앱 이름은 한국어 `사이클 페어 : 친구/연인과 함께 컨디션을 공유해요.`, 영어 `Cycle Pair`를 사용한다. 한국어 앱 내부 UI와 알림에는 짧은 브랜드 `사이클 페어`를 사용한다.
- React Native module과 native target은 공백 없는 `CyclePair`를 사용한다.
- Android application ID와 iOS bundle ID는 모두 `com.seorilabs.cyclepair`를 사용한다.
- debug와 release가 같은 영구 앱 ID를 사용한다. 두 환경을 한 기기에 동시에 설치해야 할 필요가 생기기 전에는 `.dev` suffix를 추가하지 않는다.
- 민감 건강정보의 Auth·Firestore·Functions 운영 경계는 앱 ID가 아니라 Firebase 프로젝트로 분리한다.
- 현재 개발 프로젝트는 `seorilabs-cyclepair-dev`, Firestore와 Functions 리전은 `asia-northeast3`를 사용한다.
- 운영 Firebase 프로젝트는 deployment approval 이후 별도로 만들며, 운영 로그인 제공자와 App Check 강제 정책을 함께 확정한다.
- AppsInToss 영구 `appName`은 콘솔 가용성과 정책 적합성 검토 전까지 `확정 필요`로 유지한다.
- 이전 로컬 설치의 AsyncStorage와 익명 Auth 사용자는 새 앱 ID로 자동 이전하지 않는다. 미출시 개발 데이터는 초기화하고, 실제 사용자 데이터 마이그레이션은 수행하지 않는다.

## 결과

- 공개 표시 이름을 바꾸더라도 앱의 영구 설치 식별자는 유지할 수 있다.
- 개발과 출시 식별자 불일치로 생기는 Firebase native config·OAuth·서명 혼선을 줄인다.
- 개발·운영 Firebase 데이터와 비용 경계는 유지한다.
- 기존 `seorilabs-moonmate-dev` 프로젝트는 새 프로젝트의 실검증 완료 전 삭제하지 않고 legacy 상태로 보존한다.
