# Cycle Pair MVP 위협모델

## 범위

민감한 주기·증상·기분 데이터, 두 사람의 Pair 관계, partner projection, 초대, 알림, 로컬 캐시, 계정 삭제를 다룬다. 광고, 채팅, 다중 연결, AppsInToss, E2E 암호화는 MVP 범위 밖이다.

## 보호 자산

- owner-private 생리일·증상·기분·메모
- 공유 동의와 변경 이력
- Pair 관계와 상대 식별정보
- partner projection
- 초대코드
- FCM token
- 구독 entitlement
- 내보내기 파일, 삭제 요청과 device-only 삭제 복구 receipt

## 신뢰 경계

~~~mermaid
flowchart LR
  DEVICE[사용자 기기] -->|Firebase client auth| RULES[Security Rules]
  RULES --> PRIVATE[owner-private data]
  DEVICE -->|callable auth| FN[Cloud Functions]
  FN -->|Admin SDK| PRIVATE
  FN --> PROJ[partner projection]
  FN --> FCM[FCM]
  DEVICE --> LOCAL[UID별 OS 암호화 cache와 mutation queue]
~~~

Admin SDK는 Security Rules를 우회하므로 각 Function은 작업에 맞는 권한 근거를 직접 검증해야 한다. 사용자 mutation은 Auth·대상 UID·필요 시 active Pair/공유 설정/최근 재인증을 확인하고, Auth 삭제 뒤 상태 복구는 256-bit receipt hash, provider webhook은 provider 서명, 내보내기 다운로드는 5분·단회 ticket을 사용한다.

## 주요 위협과 통제

| 위협 | 영향 | MVP 통제 | 검증 |
| --- | --- | --- | --- |
| partner가 비공개 필드를 읽음 | 민감정보 노출 | raw/projection 분리, OFF 키 제거 | Rules emulator와 projection 단위 테스트 |
| 새 partner가 이전 Pair의 동의를 승계 | 비동의 재공유 | Pair-scoped shareSettings, 새 Pair default false | revoke 후 재연결 regression 테스트 |
| 이전 partner가 계속 접근 | 관계 종료 후 노출 | Pair revoked 즉시 Rules 거부 | revoke 직후 read deny 테스트 |
| 오프라인 기기에 이전 캐시 잔존 | 로컬 노출 | 다음 sync cache 삭제 후 tombstone ack, acknowledged receipt 30일 보존 | offline revoke·ack 순서 테스트 |
| 초대코드 탈취·재사용 | 잘못된 Pair 연결 | hash, 1회성, TTL, rate limit, 원자적 수락, 만료 후 7일 보존 | replay·expired·self-invite 테스트 |
| retention cleanup이 유효한 안전 문서를 삭제 | 캐시 회수 실패·초대 수명 위반 | bounded query 후 transaction 재검증, pending/unacknowledged 삭제 금지 | policy 경계·race recheck 단위 테스트 |
| Function 권한 누락 | 전체 데이터 노출 | 공통 authz guard와 최소 Admin 경로 | negative integration 테스트 |
| 잠금화면 알림 노출 | 주변인에게 건강정보 노출 | 중립 notification payload | payload snapshot 테스트 |
| Analytics·Crashlytics 유출 | 제3자 처리·장기 보존 | 민감키 금지, 자유 텍스트 금지 | event schema와 log scrub 테스트 |
| 분실 기기 | 인증 세션·로컬 상태 노출 | 민감값 AsyncStorage 금지, Firestore disk cache 비활성, 위험 작업 최근 재인증 | 저장소 검사·기기 잠금 QA |
| 비정상 클라이언트의 backend 남용 | 대량 조회·비용·자동화 공격 | Play Integrity, App Attest(DeviceCheck fallback), 운영 App Check 강제 gate | client source tests·운영 project live 검증 |
| 계정 탈취 | 모든 기록 노출 | 이메일 검증, 위험 작업 최근 재인증 | Auth emulator·운영 정책 검증 |
| 삭제가 일부 경로에 남음 | 법적·신뢰 리스크 | recursive delete와 완료 상태 | emulator 삭제 inventory 테스트 |
| Auth 삭제 뒤 callable 응답이 유실됨 | 기기에는 실패로 보이지만 서버 삭제가 중단되거나 로컬 민감정보가 남음 | device-only 256-bit receipt, 서버에는 hash만 유지, 비인증 상태 조회, 15분 scheduled finalizer, 완료 확인 전 local barrier 유지 | 응답 유실·잘못된 receipt·Auth 소멸·finalizer 단위 및 Emulator E2E |

## 남은 보안 결정

- 운영에서 email/password·anonymous Auth를 허용할 범위와 이메일 검증 정책
- 민감정보 별도 동의문 법률 검토와 게시할 consent version
- `pairTombstones` 감사로그 보존기간. 초대 TTL 24시간, 만료 후 7일 보존, acknowledged cache tombstone 30일 보존, 시간당 5회 생성 제한은 MVP 상수로 확정
- Firebase 백업에 남는 데이터의 삭제 SLA와 사용자 안내
- 운영 App Check provider 등록, Firestore enforcement와 `ENFORCE_APP_CHECK=true` 배포 검증 시점
- 앱 잠금·생체인증 제공 여부
- E2E 암호화 후속 검토

위 항목은 현재 MVP 코드 구현과 분리된 운영·법률 결정이며, 실제 사용자 민감정보 수집과 release-candidate 승인을 막는다.
