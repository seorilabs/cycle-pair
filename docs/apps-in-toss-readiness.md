# AppsInToss readiness

현재 상태는 conditional, scaffold deferred다. 기계 판독 source of truth는 [apps-in-toss.config.json](../apps-in-toss/apps-in-toss.config.json)이다.

## 결정

- 민감 건강정보, Firebase 로그인, 외부 데이터 동기화, 두 사용자 간 공유, push, 구독 결제의 정책 적합성을 먼저 확인한다.
- 정책 적합성 확인 전 apps/ait를 만들지 않는다.
- 영구 appName을 추측하거나 선점하지 않는다.
- logo, thumbnail, screenshot 등 등록 자산을 만들거나 콘솔 앱을 생성하지 않는다.
- 부적합하면 Google Play와 App Store만 출시한다.

## 확인 질문

- 생리·증상·기분 같은 민감 건강정보 수집과 저장 허용 범위
- 사용자 간 partner projection 공유 허용 범위와 동의 요건
- 파트너에게 공유되는 메모·공동 일정의 비공개 UGC 정책 분류와 신고 요건
- Firebase Auth 또는 AppsInToss session bridge 지원 방식
- FCM 또는 AppsInToss 알림 채널 지원과 잠금화면 중립 알림
- 외부 Firebase 통신과 App Check 호환성
- 구독 또는 인앱결제 지원 여부와 정책
- 계정 삭제, 데이터 내보내기, 연결 해제 UX 요건
- TDS 사용 범위와 Health & Fitness 카테고리 존재 여부

## 채택 시 필요한 blocker

- [ ] 정책 적합성 근거 링크와 검토일
- [ ] 영구 appName
- [ ] category와 feature URLs
- [ ] 인증·저장·알림·구독 adapter 결정
- [ ] TDSProvider와 initial route
- [ ] logo 600x600
- [ ] thumbnail 1932x828
- [ ] 실제 vertical screenshots 636x1048 최소 3장
- [ ] sandbox 2인 QA
- [ ] console 수동 입력·정책 선언
- [ ] deployment 승인

AppsInToss 채택 전까지 .ait 성공 여부는 release blocker가 아니라 미채택 타깃 상태다. 채택한 뒤에는 .ait 패키징과 콘솔 등록·이미지·실결제·알림·sandbox QA를 별도 게이트로 관리한다.
