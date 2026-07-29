# App Store readiness

현재 상태는 App Store Connect 앱과 Xcode Cloud workflow 구성 완료, 첫 정상
TestFlight 빌드 대기다. 기계 판독 source of truth는
[app-store.config.json](../app-store/app-store.config.json)이다.

출시 이름은 `Cycle Pair`, 영구 iOS bundle ID는
`com.seorilabs.cyclepair`다. App Store Connect app ID는 `6792393652`,
Xcode Cloud product는 `D071BF40-979E-4D7D-A7C5-2202072488D5`,
workflow는 `Cycle Pair Release`다.

GitHub macOS runner는 사용하지 않는다. App Store Connect API가 `v*` tag를
지정해 Xcode Cloud를 시작하고, Xcode Cloud managed signing으로
`APP_STORE_ELIGIBLE` Archive를 만든다.

## 확정된 내용

- 플랫폼: iOS
- 앱 이름: Cycle Pair
- bundle ID: com.seorilabs.cyclepair
- 기본 locale: ko-KR
- primary category 후보: Health & Fitness
- 광고·tracking: 없음
- 로그인: 필요
- 건강 기록과 사용자 선택형 partner projection: 있음
- 가임기·피임 표시, 채팅, 공개 커뮤니티: 없음
- 파트너에게 선택적으로 공유할 수 있는 메모·공동 일정의 UGC 설문 분류는 확정 필요
- TestFlight는 서로 다른 계정·기기 두 명으로 검증
- Xcode Cloud: `Cycle Pair Release`
  (`6310D1DD-4A04-4E5C-8B17-B86D7A744D09`), 수동 `v*` tag,
  자동 branch build 없음
- Cycle Pair workflow build 1은 Firebase 복원 후 Bundler 4.0.6 미설치로 실패
- Cycle Pair workflow build 2는 Ruby/Bundler 설치 후 Intel image의
  `json 2.21.0` C API probe 오판으로 실패해 `json 2.7.6`으로 고정
- Cycle Pair workflow build 3은 bundle 설치 후 Archive `ARCHS`가 Ruby
  native gem에 섞여 실패해 Ruby host CPU별 path로 cache 분리
- Cycle Pair workflow build 4는 `ARCHFLAGS`가 Ruby `mkmf`에 적용되지 않아
  실패해 Bundler·CocoaPods를 Ruby host architecture로 직접 실행
- Cycle Pair workflow build 5는 `arch` 실행만으로 `mkmf` Makefile target이
  바뀌지 않아 실패해 `CONFIGURE_ARGS --with-arch_flag`로 compile·link 고정
- 새 hook으로 `pod install` 및 코드 서명 없는 Release iphoneos 로컬 빌드 성공

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

- [x] SKU
- [x] Apple Team과 Xcode Cloud automatic signing
- [x] App Store Connect 앱 shell
- [x] Xcode Cloud workflow 생성 및 API trigger 계약 구성
- [x] Xcode Cloud secret `FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64`
- [ ] support URL, privacy policy URL
- [ ] 앱 개인정보 답변
- [ ] 연령등급
- [ ] DSA trader 상태와 공개 연락처
- [ ] export compliance 최종 답변
- [ ] 심사 연락처 전화번호와 로그인 review 계정
- [ ] 구독 product ID, 가격, 혜택
- [ ] 실제 iPhone screenshots
- [ ] universal target iPad QA와 13-inch iPad screenshots
- [ ] archive와 TestFlight 처리 완료
- [ ] App Attest capability가 포함된 provisioning과 production Firebase App Check provider·Firestore/Callable 강제 live 검증
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
