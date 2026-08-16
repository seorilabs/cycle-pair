# 스토어 listing 문구 초안 (사이클 페어)

> 상태: **초안 — 검수·상표 검토 전**. 확정 후 `play-store/google-play.config.json`·`app-store/app-store.config.json`의 해당 필드에 붙여넣는다.
> 원칙(심사 안전): 의료·진단·피임 판단이나 정확한 배란일 표현 금지. 별도 동의한 가임 가능 시기는 주기 기반 참고 정보로만 설명하고, 광고·추적 없음과 "내가 허용한 만큼만 공유"를 유지한다. `docs/product-spec.md` 기준.
> 사업 결정값(가격·구독 상품·체험)은 여기서 확정하지 않는다.

## Google Play

**앱 이름**: 사이클 페어 : 내 기분, 주기, 컨디션을 알려요
**짧은 설명(≤80자, ko)**: 생리주기와 오늘의 컨디션을 두 사람이 원하는 만큼만 나누는 커플 케어 앱
**짧은 설명(en)**: Share your cycle and daily condition with one partner—only what you choose.

**전체 설명 (ko)**:
```
사이클 페어는 주기를 기록하는 사람과 가까운 한 사람이, 생리주기와 그날의 컨디션을 '내가 허용한 만큼만' 나누며 함께 대비하도록 돕는 커플 케어 앱입니다. 의료 진단이나 피임·임신 가능성 판단 도구가 아닙니다.

■ 두 사람을 위한 설계
- 정확히 두 명이 서로 수락해 연결되는 대칭형 Pair
- 연결 전에도 나만의 기록을 쓸 수 있어요

■ 내가 정하는 공유
- 생리 시작·종료일, 증상, 기분, 컨디션, 도움 선호를 기록
- 필드별로 공유를 켜고 끌 수 있고, 기본값은 전부 비공개
- 파트너에게는 내가 켠 정보만 전달돼요(원본은 나만 볼 수 있어요)

■ 함께 준비
- 다음 생리 예정일을 참고용으로 표시(개인차가 있으며 의료·피임 판단에 쓰지 않아요)
- 공동 캘린더와 기념일, 내가 요청한 도움 중심의 케어 가이드

■ 프라이버시 우선
- 잠금화면 알림은 건강정보를 드러내지 않는 중립 문구
- 광고 없음, 제3자 추적 없음, 데이터 판매 없음
- 언제든 데이터 내보내기·계정 삭제·연결 해제
```

**전체 설명 (en)**:
```
Cycle Pair helps someone who tracks their cycle and one close partner prepare together—sharing menstrual cycle and daily condition only as much as you allow. It is not a medical, diagnostic, or contraception tool.

■ Built for two
- A symmetric Pair of exactly two people who both accept the connection
- Keep private records even before connecting

■ You control sharing
- Log period start/end, symptoms, mood, condition, and help preferences
- Turn sharing on or off per field; everything is private by default
- Your partner sees only what you enable—originals stay yours

■ Prepare together
- See your next expected period as reference only (individual variation applies; not for medical or contraceptive decisions)
- Shared calendar, anniversaries, and care tips centered on the help you ask for

■ Privacy first
- Neutral lock-screen notifications that never reveal health details
- No ads, no third-party tracking, no data sales
- Export data, delete your account, or disconnect anytime
```

**출시 노트 (internal track 첫 배포, ko)**:
```
내부 테스트용 첫 빌드입니다. 기록, Pair 초대·수락·해제, 필드별 공유, 공동 캘린더, 계정 삭제·내보내기를 두 계정·두 기기로 확인해 주세요.
```

## Apple App Store

**앱 이름**: 사이클 페어 : 내 기분, 주기, 컨디션을 알려요
**부제(≤30자, ko)**: 함께 준비하는 우리의 주기  ／ (en) Prepare for the cycle together  *(config 기존값 유지)*

**프로모션 텍스트(≤170자, ko)**:
```
생리주기와 오늘의 컨디션을 파트너와 '내가 허용한 만큼만' 공유하세요. 원본은 나만, 공유는 내가 켠 것만. 광고·추적 없이 함께 대비해요.
```
**프로모션 텍스트(en)**:
```
Share your cycle and today's condition with your partner—only what you choose. Originals stay yours. No ads, no tracking. Prepare together.
```

**설명(ko/en)**: 위 Google Play 전체 설명과 동일 톤 사용(App Store는 불릿 기호 대신 줄바꿈 권장). 그대로 재사용 가능.

**키워드(≤100자, 쉼표구분, ko)**:
```
주기,생리주기,커플,파트너,컨디션,기분,공유,캘린더,커플앱,함께,케어,기념일
```
**키워드(en)**:
```
cycle,period tracker,couple,partner,condition,mood,share,calendar,care,together,relationship
```

## 확정 후 config 반영 매핑
| 파일 | 필드 |
| --- | --- |
| play-store/google-play.config.json | `storeListing.shortDescription`, `storeListing.fullDescription`, `release.releaseNotes` |
| app-store/app-store.config.json | `storeListing.promotionalText`, `storeListing.description`, `storeListing.keywords` |

### 확정 필요(사업/검수)
- 다운로드 가격·무료/프리미엄 경계, 구독 상품·가격·체험 기간
- `사이클 페어`와 `Cycle Pair` 최종 선행상표 검토
- 예측 설명 문구·케어 콘텐츠 최종 검수
- en-US 카피 원어민 검수
