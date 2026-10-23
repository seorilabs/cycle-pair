# 실제 화면 흐름

대상 소유권과 기기 승인, 전체 실행은 [네이티브 개발 검수](../docs/qa/native-development.md)를 따른다. 계약 테스트나 YAML 파싱을 실제 화면 통과로 세지 않는다.

## Android 공개 계정 입력 canary

`--scope solo --authoring --flow account-input-canary`는 로컬 Firebase의 승인된 `com.seorilabs.cyclepair.qa`만 허용한다. controller가 고정 공개값을 child 전용 환경변수로 전달한다. 외부 입력과 다른 흐름의 동시 실행을 허용하지 않는다.

홈에서 설정과 계정으로 이동하고 게스트와 비어 있는 입력3칸을 먼저 확인한다. 이메일, 비밀번호와 확인란을 실제로 누르고 입력한다. 같은 입력 ID에 이메일 표시와 secure 필드의 마스킹 길이를 대조한다. 제출 없이 닫고 다시 열어 세 칸이 비어 있는지 확인한 뒤 홈으로 돌아온다. 입력 ID3개는 테스트용 속성이며 동작과 접근성 이름을 바꾸지 않는다.

비밀번호와 확인란은 마스킹 길이까지만 확인한다. 값의 정확한 일치나 인증 성공을 증명하지 않는다. 결과의 `canaryScope`는 비밀번호 정확입력, 인증 성공과 제출을 false로 유지한다. 실제 계정 인증 흐름은 별도로 구현하고 실행해야 한다.

각 입력 검사와 닫기, 재열기, 빈칸 복원 뒤에는 `CP_ACCOUNT_CANARY stage=...`만 출력해 마지막 통과 단계를 구분한다. 이메일, 비밀번호와 계정 식별자는 출력하지 않는다.

값은 CLI 인수와 결과에 남기지 않는다. 출력 stream을 모두 읽어 가린 뒤 저장하고, 자동 화면과 원시 Maestro 자료는 임시 폴더와 함께 지운다. 이 흐름은 스크린샷을 보존하지 않는다. 실패 시 자동 재실행하지 않는다. 실패 화면을 먼저 확인하고, 공개값을 입력한 것이 확인된 경우에만 정상 뒤로 가기로 닫아 입력 정리를 확인한다. 기존 입력이 있으면 덮어쓰거나 지우지 않는다.

구현 검증은 Node 계약 검사와 캐시된 Maestro parser를 사용한다. 실제 Android 입력 실행에는 별도 GO가 필요하며, 작성자 실행은 공식 UI 회차와 전체 L3 통과가 아니다.

선택자 기준: [Maestro assertVisible](https://docs.maestro.dev/reference/commands-available/assertvisible), [복합 선택자의 AND 조건](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/how-to-use-selectors).
