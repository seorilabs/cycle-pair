# 사이클 페어 개인정보처리방침 (내부 근거 문서)

> 상태: **구현 변경안 반영 · 게시본 갱신 필요**. 현재 게시본은 `seorilabs/seorilabs-official`의 `src/lib/cyclePairPrivacyContent.ts`, 배포 commit `48882bcf1ef054212f64157e92be2fc6db984436`이며 가임 가능 시기 공유를 아직 설명하지 않는다. 게시본과 스토어 개인정보 응답을 갱신하기 전에는 이 변경을 배포하지 않는다.
> 게시본과 이 문서가 어긋나면 게시본을 기준으로 이 문서를 갱신한다. 실제 구현과 어긋나면 둘 다 구현 기준으로 갱신한다.
> 이 문서는 저장소에 문서화된 실제 데이터 처리 실태(`docs/security-threat-model.md`, `docs/google-play-readiness.md`, `docs/app-store-readiness.md`, Firebase Rules·Functions source)에서 파생했다.

- 서비스명: 사이클 페어
- 운영 주체: Seori Labs
- 대표 연락처: cs@seorilabs.com
- 게시 URL: https://www.seorilabs.com/apps/cycle-pair/privacy/ (en: `/en/apps/cycle-pair/privacy/`)
- 시행일: 2026-08-09

## 1. 개요

사이클 페어는 두 사람(파트너)이 생리주기와 컨디션을 함께 이해하고 대비하도록 돕는 관계·컨디션 커뮤니케이션 도구다. 의료·진단·피임 도구가 아니며, 정확한 배란일이나 임신 가능성·피임 판단을 제공하지 않는다. 주기 기반 가임 가능 시기는 사용자가 Pair별 전용 공유 항목을 켠 경우에만 파트너 projection으로 제공된다. 원본 건강 기록은 기본적으로 작성자 본인만 접근할 수 있다.

## 2. 수집·처리하는 개인정보

| 항목 | 수집 방식 | 이용 목적 | 처리·저장 |
| --- | --- | --- | --- |
| 계정 식별자 (Firebase Auth UID, 이메일) | 로그인 시 | 인증, Pair 연결 | Firebase Auth. 광고 추적 없음 |
| 생리일·증상·기분·메모 | 사용자 입력 | 앱 핵심 기능 | 작성자 전용(owner-private) 저장, Security Rules로 접근 통제 |
| 파트너 공유 projection | 사용자가 켠 항목만 | 사용자가 요청한 공유 | 정확히 한 명의 연결된 파트너에게만 제공 |
| 초대코드 | 앱 생성 | Pair 연결 | 해시 저장, 1회성, 24시간 TTL, 만료 후 7일 보존 |
| 알림 토큰(FCM) | 알림 동의 시 | 중립 문구 알림 발송 | 토큰만 저장, 잠금화면 문구에 건강정보 미포함 |
| 구독 entitlement | 결제 시 | 결제·부정사용 방지 | 서버 영수증 검증 결과만 저장, 클라이언트가 직접 쓰지 못함 |
| 앱 활동 이벤트 | 앱 사용 시 | 비민감 사용성 분석 | Firebase Analytics. 민감값·날짜·cyclePhase·자유 텍스트 미포함 |
| 크래시·성능 진단 | 오류 발생 시 | 안정성 | Firebase Crashlytics/Performance. PII·자유 텍스트 미포함 |

수집하지 않는 것: 광고 식별자·행태 추적, 정밀 위치, 연락처·주소록, 정확한 배란일, 임신 가능성 수치, 피임 관련 판단값.

## 3. 제3자 처리 위탁

- Google Firebase (Auth, Firestore, Cloud Functions, Cloud Messaging, Analytics, Crashlytics, Performance, App Check): 인증·저장·서버 처리·알림·진단
- Google Play / Apple App Store: 구독 결제 및 영수증 검증
- 국외 이전: Firestore `(default)`가 미국 `nam5` 멀티 리전에서 처리되므로 저장 기록은 미국으로 이전된다. 위 목록 외 추가 수탁자는 없다.

Cloud Functions는 서울 `asia-northeast3`, Firestore `(default)` 데이터베이스는 미국 `nam5` 멀티 리전에서 처리된다. Firebase Auth 등 전역 서비스의 처리 위치는 Google Firebase 약관과 데이터 위치 정책을 따른다. 제3자에게 마케팅·광고 목적으로 판매하거나 공유하지 않는다.

## 4. 파트너 공유의 성격

- Pair는 정확히 두 명이며 양쪽이 명시적으로 연결한다.
- 파트너에게는 사용자가 켠 필드만 별도 projection으로 노출되고, 원본 기록은 노출되지 않는다.
- 일반 주기 국면, 세부 생리 상태, 가임 가능 시기는 별도 필드로 동의한다. `cycleStatus` 또는 `fertilityStatus`가 없거나 false이면 대응하는 상세 상태를 projection에서 제거한다.
- 공유를 끄거나 Pair를 해제하면 해당 파트너의 서버 접근이 즉시 회수된다. 새 Pair는 이전 동의를 승계하지 않는다(기본 비공유).

## 5. 보관 기간과 파기

- 계정 삭제 시 서버는 사용자 데이터를 재귀적으로 삭제하고 완료 상태를 관리한다(자세한 절차: `docs/legal/account-deletion.md`).
- 초대코드: 만료 후 7일, acknowledged 캐시 tombstone: 30일.
- `pairTombstones`: Pair 식별자 재사용 방지 목적으로 보존하며 별도 만료가 없다. `pairId`, `memberUids`, `revokedAt`, `revokedBy`를 담아 **비식별이 아니다**. 계정 삭제 시 `accessBarrierPaths`에 포함되어 함께 삭제된다(`firebase/functions/src/index.ts`).
- 백업에 잔존하는 데이터의 삭제 SLA: 삭제 요청일로부터 30일. 게시본 「보관과 삭제」에 명시한다.

## 6. 이용자 권리와 행사 방법

- 열람·내보내기: 앱 내 데이터 내보내기(5분 만료·1회성 다운로드 링크)
- 삭제: 앱 내 계정 삭제. 위험 작업은 최근 재인증을 요구한다.
- 공유 철회: 항목별 공유 끄기, Pair 해제
- 문의: cs@seorilabs.com

## 7. 안전성 확보 조치

- 원본 민감 기록과 오프라인 변경분은 평문 저장하지 않고, 로컬 캐시는 OS 보안 저장소(Keychain 등)로 보호한다.
- 서버는 Firebase Admin 경로마다 인증·대상 UID·필요 시 최근 재인증/공유설정/파트너 서명·1회성 티켓을 검증한다.
- 비정상 클라이언트 남용 방지를 위해 App Check(Play Integrity / App Attest)를 적용한다. provider와 실기기 token 검증 전에는 monitoring-only이며, 검증이 끝난 뒤 서비스별 강제를 켠다.
- 참고: 본 MVP는 종단간(E2E) 암호화를 제공하지 않는다. 데이터는 전송·저장 구간에서 Firebase 기본 암호화와 접근통제(Security Rules·서버 검증)로 보호된다.

## 8. 아동 개인정보

최소 연령은 만 17세다. 만 17세 미만 이용자를 대상으로 하지 않으며 아동임을 알고 개인정보를 수집하지 않는다. 미성년자의 인앱 구독은 보호자 동의와 기기·스토어 결제 보호 설정을 전제로 한다.

## 9. 고지 및 변경

방침 변경 시 게시 URL과 앱을 통해 고지한다. 중요한 변경은 시행일 이전에 안내한다.

---

### 확정 이력

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 운영 주체 표기 | Seori Labs | 기존 lizard-tycoon 제품별 방침과 동일 표기 |
| 게시 URL·시행일 | `/apps/cycle-pair/privacy/`, 2026-08-09 | seorilabs-official PR #5 |
| 국외 이전 | 미국(Firestore `nam5`) | `firebase.json`, Firestore database 위치 |
| 감사로그 보존 | `pairTombstones`는 계정 삭제 시 함께 삭제 | 구현 확인 결과 90일 만료가 없어 구현 기준으로 정정 |
| 백업 삭제 SLA | 30일 | 사업 결정 |
| 최소 연령 | 만 17세 | 사업 결정 |
| en-US 번역본 | 완료 | `cyclePairPrivacyContent.en` |

### 남은 확정 필요 목록

- 민감 건강정보 별도 동의문 consent version 및 법률 검토(threat model 참조)
- Pair를 해제만 하고 계정은 유지하는 경우 `pairTombstones`가 무기한 남는다. 계정 삭제로는 정리되지만, 별도 만료 정책을 둘지 검토가 필요하다.
