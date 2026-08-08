# AppsInToss readiness

현재 상태는 build target implemented, private upload enabled, release policy review required다. 기계 판독 source of truth는 [apps-in-toss.config.json](../apps-in-toss/apps-in-toss.config.json)이다.

## 결정

- 2026-08-02 사용자 요청으로 AppsInToss build target을 채택했다.
- 정식 한글 표시명은 `사이클 페어 : 내 기분, 주기, 컨디션을 알려요`다.
- `cycle-pair`는 Console 등록 전 build용 appName 후보다. 가용성과 Console 등록값을 대조하기 전에는 영구 ID로 확정하지 않는다.
- 첫 slice는 정해진 컨디션·도움 선호를 `Storage`에 로컬 날짜와 함께 저장하고 사용자가 공식 공유 화면을 여는 흐름만 제공한다. 날짜가 바뀌면 이전 선택은 자동 삭제한다.
- 민감 건강정보, Firebase 로그인, 외부 데이터 동기화, Pair 계정 공유, push, 구독 결제의 정책 적합성은 전체 parity 전에 확인한다.
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
- [ ] `cycle-pair` Console 가용성 확인과 영구 appName 등록
- [ ] category와 feature URLs
- [ ] 인증·저장·알림·구독 adapter 결정
- [x] TDSProvider와 initial route
- [ ] logo 600x600
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

성공 시 `apps/ait/cycle-pair.ait`가 생성된다. 릴리스 판정기는 `.ait` 헤더·metadata `appName`·SDK 2.x·RN 0.84·TDS·iOS/Android bundle·payload hash를 확인하고, Console 대조 전 provisional `appName`과 placeholder icon을 차단한다. Console 등록·정식 아이콘·등록 이미지·실결제·알림·sandbox QA는 각각 별도 게이트다. 현재 AIT slice는 주기 날짜·자유 텍스트·계정 식별자를 저장하거나 공유하지 않는다.
