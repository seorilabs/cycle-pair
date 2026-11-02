# 1.3.3 공개 출시 진행

사용자 지시 `공개까지 진행해`에 따라 두 마켓의 심사 제출과 승인 후 공개까지 승인받았다. 내부 전용 1.3.2는 유지하고, 공개 계획 PR #176을 포함한 후보 `63e4e27c05abae5368c6e28818604ea509a60b39`와 태그 [v1.3.3](https://github.com/seorilabs/cycle-pair/releases/tag/v1.3.3)으로 진행했다. Issue #175.

| 마켓 | 후보 | 실제 상태 | 다음 단계 |
| --- | --- | --- | --- |
| Google Play | 1.3.3, 1000114 | 프로덕션 전체 출시 요청, 제출 ID2 검토 중 | 승인 후 자동 공개 |
| App Store | 1.3.3, 1003003 | VALID, 제출0438a989-deaf-4958-81b5-a646ad54926c WAITING_FOR_REVIEW | AFTER_APPROVAL 자동 공개 |

Google Play 소유자는 ih@seorilabs.com의 Seori Labs 조직 계정5851687664284043768이다. 내부에서 프로덕션으로 동일한1000114를 재빌드 없이 승격했다. [제출 활동](https://play.google.com/console/u/0/developers/5851687664284043768/app/4976040327651655563/publishing/submission-activity)에서 검토 중과 관리형 게시 사용 중지, 전체 출시 요청을 확인했다. [Android 빌드와 업로드](https://github.com/seorilabs/cycle-pair/actions/runs/41539140142)는 성공했다.

[Apple 빌드와 업로드](https://github.com/seorilabs/cycle-pair/actions/runs/41539147093)가 성공했으며 새 빌드1003003의 VALID를 확인한 뒤 버전에 연결했다. 기존 심사 정보를 유지하고 한국어와 영어 출시노트를 저장 후 다시 읽었다. 두 언어의 스크린샷 각4장과 기존 설명, 키워드, 지원과 개인정보 URL을 검토했다. App Store의 공개 버전은 제출 시점에 기존1.3.1이며1.3.3의 승인이나 공개를 주장하지 않는다.

같은 후보에서 실제 RN 개발 화면과 demo Firebase 합성 계정 두 개로 초대 입력과 연결, 양방향 넛지, 오프라인 복구, 기록 저장과 재실행, 언어 복원과 큰 글자를 실행했다. 모바일472개 테스트와 두 마켓 중앙 before-release 검증이 통과했다. 실제 기기와 네이티브 공유창, 푸시 수신은 미실행이다. 제품 코드와 SDK, 가격과 배포 국가는 기존 상태를 유지했다.

원본은 NAS `/Volumes/Data/Backup/agent-artifacts/cycle-pair/2026-11-03/63e4e27/public133-dev`와 같은 후보 아래 `public133-release`에 보관하고 직접 읽어 크기와 SHA-256을 대조했다. 보존 기간은 정하지 않았다. 로컬 개발 빌드와 원본 사본은 검증 후 정리한다.

현재 공개 목표는 진행 중이다. 스토어 심사는 외부 대기이며 승인, 공개와 실제 스토어 버전 재조회가 남았다. 자동 감시 작업은 설정하지 않았으며 승인 시각을 약속하지 않는다. 승인 뒤 자동 공개 설정이므로 단계별 재승인은 필요하지 않다.
