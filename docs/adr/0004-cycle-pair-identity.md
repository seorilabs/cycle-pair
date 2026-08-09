# ADR-0004: 사이클 페어 영구 앱 식별자와 단일 Firebase 프로젝트

## 상태

Accepted · 2026-07-13 · 2026-08-02 단일 프로젝트 결정으로 개정 · 2026-08-09 한국어 출시 이름과 AppsInToss 식별자 개정

2026-08-09 개정: 한국어 출시 이름을 `사이클 페어 : 친구/연인과 함께 컨디션을 공유해요.`에서 Play Console에 실제 반영된 `사이클 페어 : 내 기분, 주기, 컨디션을 알려요`로 변경했다. Play Console listing이 정본이며 저장소 config와 native 표시명을 여기에 맞춘다.

2026-08-09 개정: AppsInToss 영구 `appName`은 `cycle-pair`로 승인했다. Console 등록과 readback 전에는 출시 evidence로 인정하지 않는다.

## 배경

초기 코드명 `MoonMate`는 같은 Health & Fitness 카테고리에서 주기·기분 기록과 파트너 공유를 제공하는 동명 앱이 이미 출시돼 있어 공개 이름으로 사용할 수 없었다. 임시 Android/iOS 식별자 `com.seorilabs.moonmate.dev`와 Firebase 프로젝트 `seorilabs-moonmate-dev`는 출시 이름 결정 전 실제 백엔드 경계를 검증하기 위한 값이었다.

## 결정

- 공개 앱 이름은 한국어 `사이클 페어 : 내 기분, 주기, 컨디션을 알려요`, 영어 `Cycle Pair`를 사용한다. 한국어 앱 내부 UI와 알림에는 짧은 브랜드 `사이클 페어`를 사용한다.
- React Native module과 native target은 공백 없는 `CyclePair`를 사용한다.
- Android application ID와 iOS bundle ID는 모두 `com.seorilabs.cyclepair`를 사용한다.
- debug와 release가 같은 영구 앱 ID를 사용한다. 두 환경을 한 기기에 동시에 설치해야 할 필요가 생기기 전에는 `.dev` suffix를 추가하지 않는다.
- Auth·Firestore·Functions는 단일 Firebase 프로젝트 `seorilabs-cyclepair-prod`를 사용한다. Functions는 `asia-northeast3`, 기존 Firestore `(default)` 데이터베이스는 `nam5`에 두며 Debug와 Release의 별도 Firebase 환경은 운영하지 않는다.
- 빌드 유형은 Android/iOS 서명과 App Check provider만 구분한다. Debug는 debug provider, Release는 Play Integrity와 App Attest를 사용한다.
- 게스트 신원은 Firebase Anonymous Auth provider를 앱에서 직접 호출하지 않는다. Seorilabs Platform이 `pb_` Firebase UID를 만들고 Custom Token을 발급하며 앱은 Firebase SDK로 교환한다.
- 이메일 연결은 같은 Firebase UID를 유지하고, 이메일이 없는 `pb_` 계정만 게스트로 분류한다.
- AppsInToss 영구 `appName`은 `cycle-pair`를 사용한다. Console 등록·정식 icon URL·Sandbox 검증은 별도 출시 게이트로 유지한다.
- 이전 로컬 설치의 AsyncStorage와 익명 Auth 사용자는 새 앱 ID로 자동 이전하지 않는다. 미출시 개발 데이터는 초기화하고, 실제 사용자 데이터 마이그레이션은 수행하지 않는다.

## 결과

- 공개 표시 이름을 바꾸더라도 앱의 영구 설치 식별자는 유지할 수 있다.
- 개발과 출시 식별자 불일치로 생기는 Firebase native config·OAuth·서명 혼선을 줄인다.
- Firebase native config·배포 evidence·운영 IAM을 한 프로젝트에 결합해 환경 drift를 제거한다.
- 기존 `seorilabs-cyclepair-dev`와 `seorilabs-moonmate-dev`는 prod 인증·Rules·Functions live 검증과 리소스 inventory 뒤 데이터 이전 없이 2026-08-06 프로젝트 삭제를 요청했고 둘 다 `DELETE_REQUESTED`로 확인했다.
- 복구 기간에도 두 legacy 프로젝트를 다시 사용하지 않는다. 앱·Platform registry·배포·실검증의 유일한 Firebase 경계는 `seorilabs-cyclepair-prod`다.
