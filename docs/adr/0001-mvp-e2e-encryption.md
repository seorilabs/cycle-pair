# ADR-0001: MVP E2E 암호화 보류

- 상태: Accepted for MVP, follow-up review required
- 날짜: 2026-07-12
- 결정자: planning 승인에 따른 repo 실행 결정

## 맥락

Cycle Pair는 민감한 건강 기록을 파트너와 선택적으로 공유한다. E2E 암호화는 서버 침해 위험을 줄일 수 있지만 서버 예측, projection 생성, 알림, 계정 복구, 다기기 동기화, 데이터 내보내기를 함께 재설계해야 한다.

## 결정

MVP에는 애플리케이션 수준 E2E 암호화를 구현하지 않는다. 대신 다음을 필수로 적용한다.

- owner-private 원본과 partner projection 물리 분리
- 최소 공유 기본값과 명시적 opt-in
- Firebase Auth, Security Rules, App Check
- HTTPS/TLS와 Firebase 저장 암호화
- Admin Function의 명시적 권한 검사
- 중립 알림
- 민감 Analytics·로그 차단
- 연결 해제 즉시 서버 접근 회수와 tombstone 캐시 삭제

## 결과

- 서버는 기능 수행에 필요한 평문 데이터에 접근할 수 있다.
- Firebase/GCP 프로젝트와 Admin 권한 침해는 잔여 위험이다.
- 운영 권한 최소화, 감사, 키·자격증명 보호가 중요해진다.
- 개인정보 처리방침은 E2E를 제공한다고 표현하면 안 된다.

## 후속 결정 조건

다음 중 하나가 발생하면 새 ADR로 재검토한다.

- 외부 보안 검토가 현재 통제를 불충분하다고 판단
- 해외 출시 규제 또는 스토어 정책이 추가 보호를 요구
- 서버가 원문을 처리하지 않아도 되는 client-side projection 구조 확보
- 사용자 조사에서 E2E가 핵심 신뢰 요건으로 확인
- 다기기 키 복구와 Pair 키 회전 설계가 준비

후속 ADR은 키 생성·보관·복구·회전, 새 파트너 연결, 연결 해제, 분실 기기, 서버 알림, 내보내기, migration을 함께 다뤄야 한다.
