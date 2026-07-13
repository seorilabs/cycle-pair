# Google Play readiness

현재 상태는 구현 시작 가능, 등록·배포 불가다. 기계 판독 source of truth는 [google-play.config.json](../play-store/google-play.config.json)이다.

출시 이름은 `Cycle Pair`, 영구 Android package name은 `com.seorilabs.cyclepair`로 확정했다. Play Console 앱 shell과 release signing은 아직 만들지 않았다.

## 확정된 내용

- 앱 유형: app
- 앱 이름: Cycle Pair
- package name: com.seorilabs.cyclepair
- 기본 locale: ko-KR
- 카테고리 후보: Health & Fitness
- 광고: 없음
- 실시간 채팅과 공개 커뮤니티: 없음
- 파트너에게 선택적으로 공유할 수 있는 메모·공동 일정이 UGC 정책상 어떻게 분류되는지는 확정 필요
- 가임기·피임 표시: 없음
- 수익화: 인앱 구독 후보
- 고객지원 이메일: cs@seorilabs.com
- 최초 테스트 트랙: internal

## Data safety 초안

실제 SDK와 동의 흐름을 구현한 뒤 Console 답변을 최종 확정한다.

| 데이터 | 목적 | 처리 |
| --- | --- | --- |
| 계정 식별자 | 로그인·Pair 연결 | Firebase Auth, 광고 추적 없음 |
| 생리일·증상·기분 | 앱 기능 | owner-private 저장 |
| 사용자가 선택한 projection | 사용자 요청 공유 | 정확히 한 partner에게만 제공 |
| 알림 token | 앱 기능 | 중립 알림 발송 |
| 구독 entitlement | 결제·부정 사용 방지 | 서버 영수증 검증 |
| 앱 활동 이벤트 | 분석 | 민감 값·cyclePhase 없음 |
| crash·성능 진단 | 안정성 | PII·자유 텍스트 없음 |

“수집”과 “공유”의 Play Console 정의, 사용자 시작 전송 예외, 계정 삭제 URL 요건은 실제 구현과 정책 검토 후 답한다.

## blocker

- [ ] free/paid 최초 선택
- [ ] Play Console 앱 shell
- [ ] privacy policy URL과 계정 삭제 URL
- [ ] Data safety 검토·입력
- [ ] target audience, IARC, 한국 배포·등급 판단
- [ ] 구독 product ID, 가격, 혜택
- [ ] 1024x500 feature graphic과 실제 phone screenshots
- [ ] large/xlarge 지원 기준 7-inch·10-inch tablet screenshots 각 2장 이상
- [ ] signed AAB
- [ ] internal track 2인 테스트
- [ ] production access와 deployment 승인

## 준비 후 검증

~~~bash
python3 ${AGENT_HOME:-$HOME/.agent}/skills/google-play-store-registration/scripts/validate_play_store_config.py --root .
pnpm check:release
~~~

확정 필요 값이 남아 있는 현재 validator 실패는 정상이다. Console-only 정책 게이트는 API 적용 성공만으로 완료 처리하지 않는다.
