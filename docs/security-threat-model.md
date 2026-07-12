# MoonMate MVP 위협모델

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
- 내보내기 파일과 삭제 요청

## 신뢰 경계

~~~mermaid
flowchart LR
  DEVICE[사용자 기기] -->|Firebase client auth| RULES[Security Rules]
  RULES --> PRIVATE[owner-private data]
  DEVICE -->|callable auth| FN[Cloud Functions]
  FN -->|Admin SDK| PRIVATE
  FN --> PROJ[partner projection]
  FN --> FCM[FCM]
  DEVICE --> LOCAL[encrypted OS storage candidate]
~~~

Admin SDK는 Security Rules를 우회하므로 모든 Function은 auth, active Pair, 대상 UID, 공유 설정을 직접 검증해야 한다.

## 주요 위협과 통제

| 위협 | 영향 | MVP 통제 | 검증 |
| --- | --- | --- | --- |
| partner가 비공개 필드를 읽음 | 민감정보 노출 | raw/projection 분리, OFF 키 제거 | Rules emulator와 projection 단위 테스트 |
| 새 partner가 이전 Pair의 동의를 승계 | 비동의 재공유 | Pair-scoped shareSettings, 새 Pair default false | revoke 후 재연결 regression 테스트 |
| 이전 partner가 계속 접근 | 관계 종료 후 노출 | Pair revoked 즉시 Rules 거부 | revoke 직후 read deny 테스트 |
| 오프라인 기기에 이전 캐시 잔존 | 로컬 노출 | 다음 sync tombstone 삭제·ack | offline revoke 시나리오 |
| 초대코드 탈취·재사용 | 잘못된 Pair 연결 | hash, 1회성, TTL, rate limit, 원자적 수락 | replay·expired·self-invite 테스트 |
| Function 권한 누락 | 전체 데이터 노출 | 공통 authz guard와 최소 Admin 경로 | negative integration 테스트 |
| 잠금화면 알림 노출 | 주변인에게 건강정보 노출 | 중립 notification payload | payload snapshot 테스트 |
| Analytics·Crashlytics 유출 | 제3자 처리·장기 보존 | 민감키 금지, 자유 텍스트 금지 | event schema와 log scrub 테스트 |
| 분실 기기 | 인증 세션·로컬 상태 노출 | 민감값 AsyncStorage 금지, Firestore disk cache 비활성, 앱 재인증 후보 | 저장소 검사·기기 잠금 QA |
| 계정 탈취 | 모든 기록 노출 | 검증된 로그인, 재인증, App Check | auth provider 확정 후 테스트 |
| 삭제가 일부 경로에 남음 | 법적·신뢰 리스크 | recursive delete와 완료 상태 | emulator 삭제 inventory 테스트 |

## 남은 보안 결정

- 로그인 제공자와 계정 복구·재인증
- 민감정보 별도 동의문과 consent version
- 초대·감사로그 보존기간. 초대 TTL 24시간과 시간당 5회 생성 제한은 MVP 상수로 확정
- tombstone 최대 보존기간
- 로컬 캐시 암호화 구현
- 데이터 내보내기 포맷과 파일 만료
- Firebase 리전과 백업 삭제 약속
- 앱 잠금·생체인증 제공 여부
- E2E 암호화 후속 검토

위 항목은 스캐폴드 구현을 막지 않지만 실제 사용자 민감정보 수집과 release-candidate 승인을 막는다.
