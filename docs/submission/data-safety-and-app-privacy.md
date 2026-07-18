# Data safety / App Privacy 제출 답변 시트 (초안)

> 목적: Google Play **Data safety**와 Apple **App Privacy(Nutrition Label)** 콘솔 입력을 위한 확정안. 실제 SDK·동의 흐름 기준으로 파생했으며, `[확정 필요]`는 정책 판단·게시 URL이 필요한 항목.
> 근거: `docs/product-spec.md`(Analytics·공유·알림 정책), `docs/security-threat-model.md`, `play-store/google-play.config.json`, `app-store/app-store.config.json`.

공통 사실:
- 광고·제3자 추적 없음, 광고 식별자 미수집, 위치 미수집, 제3자 데이터 판매 없음.
- 원본 건강 기록은 owner-private, 파트너에게는 **사용자가 켠 필드만** projection으로 제공(정확히 1인).
- 처리 위탁: Google Firebase(Auth/Firestore/Functions/FCM/Analytics/Crashlytics/Performance), 결제는 Google Play/Apple.

---

## 1) Google Play — Data safety

### Security practices
| 질문 | 답 |
| --- | --- |
| 전송 중 암호화(Data encrypted in transit) | 예 (HTTPS/TLS) |
| 사용자가 데이터 삭제 요청 가능 | 예 — 앱 내 계정 삭제 + 게시 URL `[확정 필요: accountDeletionUrl]` |
| 독립 보안 검토(선택) | `[확정 필요: 미실시면 미표기]` |

### 수집 데이터 유형
| 데이터 유형 | 수집 | 공유 | 목적 | 필수/선택 |
| --- | --- | --- | --- | --- |
| 이름·이메일 등 개인 식별자(계정) | 예 | 아니오 | 계정 관리, 앱 기능 | 필수 |
| 건강 정보(생리일·증상·기분·컨디션·메모) | 예 | **아니오** (아래 주1) | 앱 기능 | 선택 |
| 구매 내역(구독 entitlement) | 예 | 아니오 | 앱 기능, 부정사용 방지 | 필수(구독 시) |
| 앱 상호작용(비민감 이벤트) | 예 | 아니오 | 분석 | 선택 |
| 크래시 로그·진단 | 예 | 아니오 | 분석/앱 기능 | 선택 |
| 기기/기타 ID(FCM 토큰) | 예 | 아니오 | 앱 기능(알림) | 선택 |

> **주1 (확정 필요)**: 파트너 projection은 "사용자가 시작한 다른 사용자에게의 전송"이다. Google Data safety의 "공유"는 통상 제3자(회사)로의 전송을 의미하고, 사용자 시작 사용자간 공유는 예외로 보는 것이 일반적이라 위 표는 "공유=아니오"로 두었다. 최종 제출 전 Play 정책 정의로 재확인한다(`userGeneratedContent` 분류와 함께). 비민감 이벤트·크래시는 Firebase가 처리하지만 이는 "수집(처리 위탁)"이지 "공유"가 아니다.

미수집으로 신고: 위치, 광고 식별자, 연락처, 문자/통화 로그, 사진/동영상 등.

---

## 2) Apple — App Privacy (Nutrition Label)

- **Data Used to Track You**: 없음 (tracking = no)
- **Data Linked to You** (앱 기능 목적):
  - Health & Fitness — 생리주기·컨디션 기록(직접 입력, HealthKit 미사용). 광고·마케팅에 사용 안 함
  - Identifiers — User ID(인증·Pair 연결)
  - Purchases — 구독 entitlement
- **Data Not Linked to You** (분석 목적):
  - Usage Data — 비민감 Product Interaction 이벤트(민감값·cyclePhase 없음)
  - Diagnostics — 크래시·성능(PII·자유 텍스트 없음)

심사 노트 연계(이미 config에 초안 존재): owner-private 원본 vs 선택형 partner projection 분리, 동의 회수 흐름, 비의료·비피임, 중립 알림.

> 참고: `app-store/app-store.config.json`의 `appPrivacy.dataTypes`가 위와 정합한다. `productInteraction`·`crashAndPerformance`는 identity에 결합하지 않으므로 "Not Linked"로 매핑했다. Firebase Analytics의 app-instance ID 결합 수준에 대해 보수적으로 판단하려면 "Usage/Diagnostics = Linked"로 올릴 수 있으나, tracking=no·비민감 원칙은 동일하다.

---

## 콘솔 입력 후 반영할 config 값
| 파일 | 필드 | 값 |
| --- | --- | --- |
| play-store/google-play.config.json | `contentDeclarations.dataSafety` / `dataSafetyCsv` | 위 표 반영 후 evidence 기록 |
| app-store/app-store.config.json | `appPrivacy.status` | 위 매핑 반영 |
| 양측 | `privacyPolicyUrl`, `accountDeletionUrl`(Play) | 게시 URL |

### 확정 필요 목록
- 파트너 projection의 "공유/UGC" 최종 분류(Play 정책 정의)
- 게시 URL(개인정보처리방침, 계정삭제 안내)
- 독립 보안 검토 표기 여부
- 연령등급 답변(별도: IARC/App 연령등급 설문)
