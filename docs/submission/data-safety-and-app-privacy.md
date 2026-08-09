# Data safety / App Privacy 제출 답변 시트

> 목적: Google Play **Data safety**와 Apple **App Privacy(Nutrition Label)** 콘솔 입력을 위한 구현 기준 답변안. 콘솔 저장과 readback은 사용자 검토 후 별도 evidence로 남긴다.
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
| 사용자가 데이터 삭제 요청 가능 | 예 — 앱 내 계정 삭제 + `https://www.seorilabs.com/apps/cycle-pair/account-deletion/` |
| 독립 보안 검토(선택) | 미표기 — 독립 보안 검토 evidence 없음 |

### 수집 데이터 유형
| 데이터 유형 | 수집 | 공유 | 목적 | 필수/선택 |
| --- | --- | --- | --- | --- |
| 이메일 주소 | 예 | 아니오 | 계정 관리, 앱 기능 | 선택(이메일 로그인 사용 시) |
| User ID (Firebase Auth UID) | 예 | 아니오 | 계정 관리, 앱 기능, 보안·부정사용 방지 | 필수 |
| 건강 정보(생리일·증상·기분·컨디션·메모) | 예 | **아니오** (아래 주1) | 앱 기능 | 선택 |
| 사용자 생성 콘텐츠(비공개 메모·공동 일정) | 예 | 아니오 | 앱 기능 | 선택 |
| 구매 내역(구독 entitlement) | 예 | 아니오 | 앱 기능 | 선택(구독 시) |
| 앱 상호작용(비민감 이벤트) | 예 | 아니오 | 분석 | 선택 |
| 크래시 로그·진단 | 예 | 아니오 | 분석/앱 기능 | 선택 |
| 기기/기타 ID(FCM 토큰·Firebase installation ID) | 예 | 아니오 | 앱 기능(알림), 보안·부정사용 방지 | 필수/선택은 기능별 선언 참조 |

> **공유 판단 근거**: Firebase는 앱 개발자를 대신 처리하는 service provider이고, 파트너 projection과 시스템 공유는 사용자가 명시적으로 시작하는 전송이다. Google Play Data safety의 service provider·user initiated action 예외에 따라 위 표는 "공유=아니오"로 작성했다. 제출 직전에 [Google Play 공식 정의](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)를 다시 확인한다. 비민감 이벤트·크래시는 Firebase로 전송되므로 "수집"에는 포함한다.

미수집으로 신고: 위치, 광고 식별자, 연락처, 문자/통화 로그, 사진/동영상 등.

---

## 2) Apple — App Privacy (Nutrition Label)

- **Data Used to Track You**: 없음 (tracking = no)
- **Data Linked to You** (앱 기능 목적):
  - Health & Fitness — 생리주기·컨디션 기록(직접 입력, HealthKit 미사용). 광고·마케팅에 사용 안 함
  - Contact Info — 이메일 주소(이메일 로그인 사용 시)
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

### 남은 Console gate
- Google Play Data safety와 IARC 답변 사용자 검토, 저장, readback
- App Store App Privacy와 연령등급 답변 저장, readback
- Apple 계산 등급이 서비스 최소 연령보다 낮을 경우 18+ override
