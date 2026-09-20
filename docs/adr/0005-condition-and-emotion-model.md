# ADR-0005: 컨디션 기록의 감정 축 신설과 중복 축 제거

## 상태

Proposed · 2026-09-20

## 배경

하루 기록이 7필드다. `bleeding`, `symptoms`, `mood`, `energy`, `condition`, `helpPreferences`, `note`. 매일 채우기에 무겁고, 그중 세 축이 서로 겹친다.

```ts
mood?:      "very-low" | "low" | "neutral" | "good" | "very-good"   // 5단계 척도
energy?:    1 | 2 | 3 | 4 | 5                                        // 5단계 척도
condition?: comfortable | tired | low-energy | cramps | headache | sensitive | needs-space | other
```

- `tired`, `low-energy` 는 `energy` 와 같은 것을 묻는다
- `sensitive` 는 `mood` 와 같은 것을 묻는다
- **감정은 좋다/나쁘다 방향만 있고 "어떤 감정인지"가 없다**

마지막 항목이 이 ADR 의 출발점이다. 이 앱은 파트너가 상대의 상태를 알고 돌보라고 만든 것인데, 정작 "불안한지 서운한지 외로운지"를 담을 자리가 없다. `helpPreferences`(들어주기·혼자 있기·따뜻하게·밥 챙기기·일정 조정·실질적 도움·안부·아무것도)는 이미 잘 만든 돌봄 축이므로, 비어 있는 것은 감정 축 하나다.

## 조사 결과

### 도메인 이름과 저장 이름이 다르다

| 도메인 `models.ts` | 저장·전송 |
| --- | --- |
| `mood` | `moodTag` |
| `energy` | `energyLevel` |
| `condition` | `conditionCode` |
| `helpPreferences` | `carePreferences` |
| `symptoms` | `symptomTags` |

매핑은 `apps/mobile/src/platform/backend/backendPayloads.ts` 에 있다. **도메인 타입 이름을 바꿔도 저장 스키마는 따라오지 않는다.** 두 층을 따로 설계해야 한다.

### prod 데이터는 11건이고 전부 내부 테스트 데이터다

2026-09-20 `seorilabs-cyclepair-prod` 집계다. 기록 내용은 읽지 않고 필드 보유 수와 값 분포만 집계했다.

```
사용자(하위 문서 보유)  8명
privateDailyLogs       11건      privateCycles  7건
schemaVersion          전부 2

moodTag        neutral 6 · low 2 · very-good 1 · very-low 1 · good 1
conditionCode  comfortable 4 · tired 3
energyLevel    3:5 · 2:3 · 4:1
```

이 앱은 아직 공개 출시 전이다. Google Play 내부 테스트와 TestFlight 만 있다.

### 닿는 범위는 34개 파일이다

경계를 넘는 지점이 중요하다.

```mermaid
flowchart LR
  A["앱 기록 화면"] --> B["backendPayloads<br/>도메인 이름을 저장 이름으로"]
  B --> C["Firestore<br/>users/uid/privateDailyLogs"]
  C --> D["firestore.rules<br/>필드 화이트리스트와 값 검증"]
  C --> E["functions projection<br/>공유 설정에 따라 걸러서 내보냄"]
  E --> F["pairs/pairId/projections"]
  F --> G["파트너 화면 문구"]
  H["care-tips<br/>돌봄 제안 규칙"] --> A
```

- `firebase/firestore.rules` 158~192행: 허용 필드 목록과 값 열거
- `firebase/functions/src/domain/projection.ts`: `moodTag`·`energyLevel`·`conditionCode`·`carePreferences` 를 공유 설정으로 걸러 내보낸다
- `apps/mobile/src/app/partnerProjectionPresentation.ts`: `moodCopy` 로 파트너 문구를 만든다
- `packages/product-core/src/domain/sharing.ts`: `SHAREABLE_FIELDS` 에 `mood`·`condition` 이 있다
- `packages/product-core/src/domain/care-tips.ts`: `match.conditions` 에 `tired`·`low-energy` 를 쓴다

## 결정

### D1. 감정 축을 신설한다

`mood`(5단계 척도)를 대체하는 `emotion`(감정 코드)을 만든다. 저장 필드는 `emotionTag` 다.

값은 긍정과 부정을 균형 있게 담고, 진단이나 의학적 단정을 하지 않는 중립 어휘를 쓴다. 초안은 `calm`·`happy`·`affectionate`·`anxious`·`irritable`·`hurt` 이며 **확정은 이 ADR 의 미해결 질문으로 남긴다.**

### D2. 중복 축을 제거한다

`energy`(1~5)는 그대로 둔다. `ConditionCode` 에서 `tired`·`low-energy`·`sensitive` 를 뺀다. 남는 값은 `comfortable`·`cramps`·`headache`·`needs-space`·`other` 로, 몸 상태만 남는다.

`care-tips` 의 `match.conditions: ["tired", "low-energy"]` 규칙은 `energy <= 2` 조건으로 옮긴다. 같은 의도를 중복 없이 표현한다.

### D3. 기본 화면은 두 가지만 묻는다

`지금 마음`(감정)과 `뭐가 필요해요?`(돌봄) 둘만 기본 노출한다. 생리·증상·기력·메모는 접어 둔다. 하루 기본 입력이 7필드에서 2필드가 된다.

필드를 지우는 것이 아니라 **기본 노출을 줄이는 것**이다. 기록하고 싶은 사람은 펼쳐서 다 쓸 수 있다.

### D4. 기존 기록을 변환하지 않는다

**5단계 척도에서 감정 이름을 복원하는 것은 원리적으로 불가능하다.** `low` 가 불안인지 서운함인지 외로움인지는 기록 어디에도 없다. 추측해서 채우면 사용자가 쓰지 않은 것을 쓴 것처럼 남긴다. 건강 기록에서는 허용할 수 없다.

`schemaVersion` 을 3으로 올리고, 2 이하 기록은 읽을 때 감정 축을 `undefined` 로 둔다. 기존 `moodTag` 값은 **지우지 않고 보존한다.**

ADR-0004 가 이미 같은 원칙을 세웠다. "미출시 개발 데이터는 초기화하고, 실제 사용자 데이터 마이그레이션은 수행하지 않는다." 여기서는 한 걸음 더 보수적으로, 초기화도 하지 않고 그대로 둔다. 11건을 지워서 얻을 것이 없다.

### D5. 필드를 갈아끼우지 않고 더한다

`emotionTag` 를 추가하고 `moodTag` 는 **쓰기만 중단한다.** 규칙은 두 필드를 모두 허용하되 새 쓰기는 `emotionTag` 만 만든다.

이유는 롤백이다. 필드를 rename 하면 되돌릴 때 그사이 쓰인 데이터가 사라진다. 추가는 되돌려도 남는다.

`moodTag` 의 완전한 제거는 공개 출시 이후 최소 한 번의 정규 릴리스를 지나고 나서 별도로 판단한다.

### D6. 공유 경계를 같이 바꾼다

- `SHAREABLE_FIELDS` 의 `mood` 를 `emotion` 으로 바꾼다
- `firestore.rules` 화이트리스트에 `emotionTag` 와 허용 값을 추가한다
- `projection.ts` 가 공유 설정에 따라 `emotionTag` 를 내보내게 한다
- 파트너 문구를 감정 코드별로 추가한다

**가임 정보 역추론 검토.** #48 에서 배란기 값이 필드 존재 여부로 새어 나가지 않도록 접는 규칙을 세웠다. 감정 값은 주기 위상을 역추론하게 하지 않으므로 접기 대상이 아니다. 다만 `emotionTag` 도 다른 필드와 똑같이 **날짜와 무관하게 필드 존재 여부가 일정해야 한다**는 불변식은 지킨다.

### D7. 감정 기본 공유는 꺼진 상태로 시작한다

현재 공유 설정 기본값은 비공개다. `emotion` 도 같다. 파트너에게 보이게 하려면 사용자가 켜야 한다.

## 결과

- 하루 기본 입력 7필드 → 2필드
- 중복 축 세 개 제거, 각 축이 하나의 질문만 담는다
- 감정이라는 빈 자리가 채워져 돌봄 제안이 실제 감정에 반응할 수 있다
- 필드 추가 방식이라 롤백 가능하다
- 기존 11건은 감정 없이 남는다. 내부 테스터에게는 이전 기록의 기분이 그대로 보관되고 오늘부터 감정으로 기록되는 것으로 보인다

## 대안과 기각 사유

**A1. `mood` 값을 감정으로 기계 변환한다** — 기각. 복원 불가능한 정보를 지어내는 것이다.

**A2. 기존 기록을 삭제하고 새로 시작한다** — 기각. 내부 테스터의 기록도 기록이다. 보존 비용이 11건 기준으로 사실상 0이다.

**A3. `mood` 를 두고 감정을 추가한다** — 기각. 입력 부담이 늘고, 애초에 문제였던 중복 축이 하나 더 늘어난다.

**A4. `moodTag` 를 `emotionTag` 로 in-place rename 한다** — 기각. 롤백 시 손실이 생긴다. D5 참조.

## 미해결 질문

1. **감정 코드 목록 확정.** 6개로 충분한가. `외로움`·`지침` 을 넣을 것인가. `그 외`를 둘 것인가
2. **다중 선택 허용 여부.** 현재 `mood` 는 단일 선택이다. 감정은 여러 개가 동시에 성립할 수 있다
3. **`moodTag` 제거 시점.** 공개 출시 후 몇 번의 릴리스를 지나고 지울 것인가

이 셋은 구현 PR 전에 정한다.
