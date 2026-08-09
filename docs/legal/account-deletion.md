# 사이클 페어 계정·데이터 삭제 안내 (내부 근거 문서)

> 상태: **게시 확인**. 게시본은 `seorilabs/seorilabs-official`의 `src/lib/cyclePairAccountDeletionContent.ts`이며 이 저장소 문서는 그 근거를 남기는 내부 문서다. 배포 commit `48882bcf1ef054212f64157e92be2fc6db984436`, ko/en URL의 HTTP 200을 2026-08-09T08:29:02Z에 재확인했다.
> 절차 설명은 Cloud Functions 삭제 흐름(`beginAccountDeletion` → `deleteMyAccount` → 15분 scheduled finalizer, device-only receipt) 구현을 기준으로 작성했다.

- 서비스명: 사이클 페어
- 운영 주체: Seori Labs
- 문의: cs@seorilabs.com
- 게시 URL: https://www.seorilabs.com/apps/cycle-pair/account-deletion/ (en: `/en/apps/cycle-pair/account-deletion/`)

## 앱에서 계정 삭제하기

1. 사이클 페어 앱을 연다.
2. 설정 → 개인정보/계정 영역의 **계정 삭제**를 선택한다.
3. 보안을 위해 최근 로그인 재인증을 요청할 수 있다. 안내에 따라 재인증한다.
4. 삭제를 확인하면 서버가 삭제를 시작하고, 완료 상태를 앱에서 확인할 수 있다.

앱에 접근할 수 없는 경우 cs@seorilabs.com 으로 삭제를 요청할 수 있다. 요청 본문에는 가입 이메일 주소, 사용 기기, 대략적인 계정 생성 시점만 받고 건강 기록과 초대코드는 받지 않는다. 본인확인은 가입 이메일로 확인 메일을 보내 회신을 받는 방식으로 하며, 확인 후 삭제를 처리하고 결과를 회신한다.

## 삭제되는 데이터

- 생리일·증상·기분·메모 등 본인 기록(owner-private)
- Pair 관계 및 파트너에게 제공되던 projection(공유 즉시 회수)
- 초대코드, 알림 토큰(FCM), 구독 entitlement 문서 등 계정에 연결된 문서
- 인증(Auth) 계정

서버는 데이터를 재귀적으로 삭제하며, 삭제 요청 응답이 유실되어도 15분 주기 finalizer가 완료를 보장한다. 완료 확인 전까지 기기에는 로컬 민감정보 접근을 막는 barrier가 유지된다. 삭제 완료 상태 복구는 기기에만 저장된 1회성 receipt로만 확인하며, 서버에는 receipt의 해시만 남긴다.

## 유지될 수 있는 데이터와 기간

- 법령상 보존이 필요한 최소 정보: 구독 결제 기록은 전자상거래 등에서의 소비자보호에 관한 법률 등 관계 법령이 정한 기간 동안 보존한 뒤 삭제하거나 비식별화한다.
- 백업에 잔존하는 데이터의 파기 SLA: 삭제 요청일로부터 30일.
- `pairTombstones`: 계정 삭제 시 `accessBarrierPaths`에 포함되어 함께 삭제되므로 삭제 후 잔존하지 않는다.

## 처리 기간

앱 안에서 확인한 삭제는 온라인 상태에서 즉시 처리된다. 응답이 유실되어도 15분 주기 finalizer가 완료를 보장한다. 이메일 요청은 본인확인 완료 후 처리하며, 백업 잔존분까지 포함한 전체 파기는 요청일로부터 30일 이내에 완료된다.

---

### 확정 이력

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 운영 주체 표기 | Seori Labs | 기존 babycare 계정 삭제 안내와 동일 표기 |
| 게시 URL | `/apps/cycle-pair/account-deletion/` | seorilabs-official PR #5 |
| 앱 외 요청 본인확인 | 가입 이메일 확인 메일 회신 | 사업 결정 |
| 백업 삭제 SLA | 30일 | 사업 결정 |
| tombstone | 계정 삭제 시 함께 삭제 | `index.ts` accessBarrierPaths |
| en-US 번역본 | 완료 | `cyclePairAccountDeletionContent.en` |
