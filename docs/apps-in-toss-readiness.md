# AppsInToss readiness

현재 상태는 build target implemented, private upload enabled, release policy review required다. 기계 판독 source of truth는 [apps-in-toss.config.json](../apps-in-toss/apps-in-toss.config.json)이다.

## 결정

- 2026-08-02 사용자 요청으로 AppsInToss build target을 채택했다.
- Console 글자 수 규격에 맞춘 정식 AIT 표시명은 짧은 브랜드 `사이클 페어`다.
- 영구 appName은 `cycle-pair`로 승인됐다. Console 가용성 확인과 영구 등록·readback 전에는 `confirmed-console-match` evidence로 올리지 않는다. 현재 연결된 Console 계정에는 워크스페이스가 없어 등록하지 못했다.
- 첫 slice는 정해진 컨디션·도움 선호를 `Storage`에 로컬 날짜와 함께 저장하고 사용자가 공식 공유 화면을 여는 흐름만 제공한다. 날짜가 바뀌면 이전 선택은 자동 삭제한다.
- 이 slice에는 Firebase 로그인, 외부 데이터 동기화, Pair 계정 공유, push, 구독 결제, 자유 텍스트가 없다. 이 항목들은 `not-applicable`로 분리하고 모바일 전체 앱 선언을 재사용하지 않는다.
- 기존 브랜드 원본으로 600x600 PNG 로고를 만든다. 썸네일·스크린샷은 등록된 `cycle-pair`를 Sandbox에서 실제 실행한 화면만 사용한다.
- 부적합하면 Google Play와 App Store만 출시한다.

## 실제 AIT slice 선언

- 입력: 미리 정의된 컨디션과 도움 선호 선택
- 저장: AppsInToss Storage에 로컬 날짜 기준 당일만 보관
- 전송: 사용자가 버튼을 누른 경우에만 시스템 공유 화면으로 전달
- 제외: Firebase Auth·Firestore·FCM·App Check, 외부 저장, Pair 동기화, push, 구독·인앱결제, 자유 텍스트

## 채택 시 필요한 blocker

- [ ] 정책 적합성 근거 링크와 검토일
- [ ] `cycle-pair` Console 가용성 확인과 영구 appName 등록
- [x] 실제 Console category `생활 > 건강 > 건강 관리`와 `컨디션 공유` feature URL 준비
- [ ] 인증·저장·알림·구독 adapter 결정
- [x] TDSProvider와 initial route
- [x] 기존 브랜드 원본 기반 logo 600x600
- [ ] thumbnail 1932x828
- [ ] 실제 vertical screenshots 636x1048 최소 3장
- [ ] sandbox 2인 QA
- [ ] console 수동 입력·정책 선언
- [x] 비공개 후보 업로드 승인
- [ ] sandbox QA와 공개 deployment 승인

## 빌드

```bash
pnpm check:ait
pnpm build:ait
```

Backoffice의 앱별 `릴리스 > 빌드 산출물`에서는 기존 `vX.Y.Z` 태그로 `.ait`
후보만 만들 수 있다. `배포 > AppsInToss`는 같은 태그를 x64 Linux에서 다시
검증·빌드해 artifact를 3일 보관하고 `ait deploy`로 비공개 업로드한다. 콘솔
appName 확정, 정책 검토, sandbox QA와 공개 deployment 승인은 여전히 별도
blocker다.

성공 시 `apps/ait/cycle-pair.ait`가 생성된다. 릴리스 판정기는 `.ait` 헤더·metadata `appName`·SDK 2.x·RN 0.84·TDS·iOS/Android bundle·payload hash를 확인하고, Console 대조 전 appName과 placeholder icon을 차단한다. 이 단계의 build smoke 산출물은 최종 main/tag artifact가 아니므로 release evidence는 `missing`으로 유지한다. Console 등록·정식 icon URL·실화면 등록 이미지·sandbox QA는 각각 별도 게이트다.
