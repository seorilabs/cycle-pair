# `@cyclepair/product-core`

Cycle Pair의 플랫폼 독립 TypeScript 코어다. 도메인 모델, 순수 계산, projection 정책과 port interface만 포함한다. Firebase, React Native, AppsInToss, 스토어 SDK, 네트워크·디바이스 API를 import하지 않는다.

## 제공 범위

- `LocalDate` 검증·달력 연산
- 정확히 두 명으로 구성되는 `Pair` invariant
- `Cycle`·`CycleLog`, 평균 주기와 다음 시작일 예측, `CyclePhase`
- 필드 단위 `ShareSettings`와 파트너용 `PartnerProjection`
- 자기보고 도움 선호·컨디션을 예측 국면보다 우선하는 `CareTip`
- 잠금 화면에 건강정보를 쓰지 않는 중립 알림 일정
- 구독 상태를 실패 폐쇄(fail-closed)로 해석하는 `Entitlement`
- 인증·저장소·알림·결제·시계·ID 생성 adapter용 port

## 알고리즘 가정과 제약

### 날짜

- `LocalDate`는 `YYYY-MM-DD` 형식의 Gregorian 달력 날짜이며 시간과 시간대를 갖지 않는다.
- 지원 연도는 0001~9999다. 시스템의 현재 날짜는 코어가 직접 읽지 않고 `ClockPort`가 전달한다.

### 주기 예측

- 서로 다른 시작일을 오름차순 정렬한 뒤 인접 시작일 간격을 사용한다.
- 기본 유효 간격은 15~60일이며 범위 밖 간격은 평균에서 제외하고 신뢰도를 `low`로 낮춘다.
- 유효 간격 한 개부터 예측할 수 있지만 신뢰도는 `low`다. 평균은 가장 가까운 정수 일수로 반올림한다.
- 사용자가 온보딩에서 입력한 평균 주기만으로 만든 seed 예측은 관측 이력을 꾸며내지 않으며 `sampleSize: 0`, `confidence: low`, ±7일 범위로 고정한다.
- 신뢰도 휴리스틱은 `high` = 간격 5개 이상이면서 표준편차 2일 이하, `medium` = 3개 이상이면서 표준편차 4일 이하, 나머지는 `low`다.
- 예상 범위는 각각 ±2일, ±4일, ±7일이다. 이는 제품용 단순 통계이며 의료 진단, 피임 또는 임신 판단에 사용할 수 없다.
- 누락 기록, 산후·약물·질환·불규칙 주기 보정은 MVP에 포함하지 않는다.

### 국면 판정과 MVP 비노출 정책

- 기본 월경 길이 5일, 황체기 14일, 내부 배란 추정 창 ±1일을 사용하며 마지막 시작일부터 한 번의 예상 주기 안에서만 판정한다. 범위 밖은 `unknown`이다.
- `ovulatory`는 내부 계산에만 존재한다. MVP의 `PartnerProjection`에서는 해당 키를 아예 만들지 않는다.
- `CareTip` 반환값에는 매칭 phase 규칙이 포함되지 않고, 알림 payload에도 정확한 배란·가임·주기 신호가 포함되지 않는다.

### 공유와 보안

- 모든 공유 필드의 기본값은 비공개다. 허용되지 않거나 값이 없는 필드는 `undefined` 값을 넣는 대신 결과 객체에서 키 자체를 생략한다.
- `periodDates`를 허용하면 현재 `Cycle`의 시작일과 선택적 종료일만 복사하며 cycle ID나 다른 기록은 노출하지 않는다.
- projection은 표시용 최소화 계층이다. 서버 접근통제를 대신하지 않으며 Firebase adapter는 pair 관계와 공유 설정을 Security Rules에서도 다시 검증해야 한다.

### 케어 팁

- 우선순위는 `명시한 도움 선호 > 자기보고 컨디션 > 내부 추정 국면 > 일반 팁`이다.
- 팁은 관계·커뮤니케이션 제안이며 증상을 진단하거나 치료하지 않는다.

### 알림

- 기본 일정은 예측일 3일 전과 당일 오전 9시다. 이미 지난 항목은 만들지 않는다.
- 표시 문구와 목적지는 중립적이며 `visibility: private`를 요구한다. 다만 전달 시각 자체도 민감한 추론에 사용될 수 있으므로 adapter와 서버 로그에서 최소 보관해야 한다.

### 구독 권한

- `active`, `trialing`, `canceled`는 유효 종료일이 오늘 이상일 때만 premium이다. grace period도 명시된 종료일까지만 인정한다.
- 종료일이 없는 active 상태와 알 수 없는 상태는 free로 실패 폐쇄한다.
- `multiple-connections`는 후속 버전 예약 타입일 뿐 MVP의 premium 결과에도 활성화하지 않는다. 하나의 `Pair`는 항상 서로 다른 정확히 두 명이다.

## 검증

```bash
pnpm run check:architecture
pnpm run typecheck
pnpm run test
pnpm run build
```
