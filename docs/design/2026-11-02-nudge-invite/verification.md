# 수정과 검증 기록

2026-11-02, Issue [#170](https://github.com/seorilabs/cycle-pair/issues/170). 사용자 요청 범위의 L1 작성자 실행이다.

## 운영 넛지 복구

`seorilabs-cyclepair-prod`의 `sendPartnerNudge`, `acknowledgePartnerNudge`가 ACTIVE지만 Cloud Run에서 HTTP 403을 반환했다. 두 서비스의 invoker IAM 검사는 켜져 있고 공개 호출 권한은 없었다. 같은 프로젝트의 초대 서비스는 공개 호출 권한을 갖고 정상 호출됐다.

두 기존 넛지 서비스에 `run.googleapis.com/invoker-iam-disabled=true`를 적용했다. 2026-11-02 13:48:31 UTC의 재조회에서 두 서비스 모두 Ready였다. revision은 각각 `sendpartnernudge-00005-did`, `acknowledgepartnernudge-00004-yem`으로 유지됐다. 함수 소스 배포, 로그인 검사, 커플 권한, 사용자 자료와 자격증명은 변경하지 않았다.

`node scripts/check-nudge-access.mjs`로 두 주소에 로그인 없는 빈 Callable 요청을 보내 HTTP 401과 `UNAUTHENTICATED`를 확인했다. 이것은 운영 진입점과 로그인 거부 검증이며 실제 운영 계정 사이의 넛지 전송이나 APNs, FCM 전달 검증은 아니다. 개인 건강 자료는 조회하지 않았다.

변경 전 설정은 NAS `/Volumes/Data/Backup/agent-artifacts/cycle-pair/2026-11-02/0acac3be/nudge-invite-2245`에 복사하고 직접 다시 읽어 SHA-256 `ccc1a78112de167b03a00af34a72176402fc4f68a2864585cd837e9a36f151f8`을 대조했다. v2 설정 요청은 revision 충돌 409로 적용되지 않았고, v1의 기존 서비스 주석 변경으로 적용했다.

공식 근거: [Cloud Run 공개 호출 설정](https://docs.cloud.google.com/run/docs/authenticating/public). Firebase Callable의 로그인 검사가 요청을 받도록 Cloud Run 진입점을 열어야 한다.

## 앱 수정 검증

- 실패 재현: 코드 외 문구가 들어간 공유 본문, 43자 입력 제한, 다른 탭에서 수신 알림 누락을 테스트로 확인했다.
- 자동 검사: 모바일 59개 파일 472개 테스트, 공통 로직 59개 테스트, 모바일 TypeScript와 ESLint, 아키텍처, `git diff --check` 통과.
- 실제 RN Web과 demo Firebase의 합성 계정 두 개로 초대 문구 전체 붙여넣기, 코드 추출과 연결, 공유 설정 저장을 확인했다.
- `확인했어요` 전송, 홈에서 수신 알림, 알림으로 파트너 탭 이동, 수신 확인과 제거, 재실행 후 30분 제한 복원을 확인했다.
- 오프라인 전송 안내, 연결 복구 후 재시도, 반대 방향의 `오늘 어때요?` 수신을 확인했다.
- 390px와 320px, 글자 200%의 기존 화면을 확인했다. 핵심 수신 확인과 전송 버튼에 접근할 수 있고 가로 넘침은 없었다.
- 초기 생리기간 화면은 5일이다. 설정한 개인별 기간은 변경하지 않았다.

RN Web은 실제 앱, Store와 Firebase 백엔드를 실행하며 플랫폼 경계만 개발 구현을 사용한다. OS 공유창, 실제 기기, 보안 저장소의 네이티브 보장, 실제 푸시 전달은 미실행이다. 마켓 빌드, 업로드, 심사 제출과 공개 배포는 이번 요청에 포함하지 않는다.

증적 원본은 NAS의 같은 날짜 아래 `nudge-invite-validation` 폴더에 보관한다. 복사 검증 후 로컬 캡처, 로그와 개발 빌드는 정리한다.
