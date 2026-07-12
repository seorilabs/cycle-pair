# App Store readiness

현재 상태는 구현 시작 가능, App Store Connect 등록·TestFlight 업로드 불가다. 기계 판독 source of truth는 [app-store.config.json](../app-store/app-store.config.json)이다.

현재 iOS bundle ID com.seorilabs.moonmate.dev는 로컬 스캐폴드용이며 App Store Connect 영구 bundle ID로 확정한 값이 아니다.

## 확정된 내용

- 플랫폼: iOS
- 기본 locale: ko-KR
- primary category 후보: Health & Fitness
- 광고·tracking: 없음
- 로그인: 필요
- 건강 기록과 사용자 선택형 partner projection: 있음
- 가임기·피임 표시, 채팅, 공개 커뮤니티: 없음
- 파트너에게 선택적으로 공유할 수 있는 메모·공동 일정의 UGC 설문 분류는 확정 필요
- TestFlight는 서로 다른 계정·기기 두 명으로 검증

## App Privacy 초안

실제 Firebase SDK, 로그인 방식, 구독 구현을 기준으로 App Store Connect에서 다시 검토한다.

| 데이터 유형 후보 | 목적 | tracking |
| --- | --- | --- |
| User ID | 인증·Pair 연결 | no |
| Health | 주기·컨디션 기록과 명시적 공유 | no |
| Purchases | entitlement | no |
| Product Interaction | 비민감 퍼널 분석 | no |
| Crash Data, Performance | 안정성 | no |
| Push Token | 앱 기능 | no |

Health 데이터 공유는 사용자 제어 기능의 본질이므로 review notes에 owner-private/projection 분리와 동의 회수 흐름을 설명한다.

## blocker

- [ ] 최종 앱 이름
- [ ] 영구 bundle ID와 SKU
- [ ] Apple Team과 signing 방식
- [ ] App Store Connect 앱 shell
- [ ] support URL, privacy policy URL
- [ ] 앱 개인정보 답변
- [ ] 연령등급
- [ ] DSA trader 상태와 공개 연락처
- [ ] export compliance 최종 답변
- [ ] 심사 연락처 전화번호와 로그인 review 계정
- [ ] 구독 product ID, 가격, 혜택
- [ ] 1024 아이콘과 실제 iPhone screenshots
- [ ] iPad 지원 여부와 필요 시 iPad 자산
- [ ] archive와 TestFlight 처리 완료
- [ ] 2인 TestFlight 테스트
- [ ] deployment 승인과 Submit for Review

## 심사 노트에 포함할 핵심

- 의료·진단·피임 앱이 아닌 관계·컨디션 커뮤니케이션 도구
- Pair는 정확히 두 명이며 양쪽이 명시적으로 연결
- 원본 건강 데이터는 소유자 전용
- 파트너에게는 사용자가 켠 필드만 별도 projection으로 제공
- 공유 해제와 Pair 해제 시 서버 접근 즉시 회수
- 잠금화면 알림은 중립 문구
- 광고와 추적 없음

Upload succeeded는 제출 완료가 아니다. build processing, version 선택, TestFlight 설정, privacy·등급·심사 입력, Submit for Review를 각각 확인한다.
