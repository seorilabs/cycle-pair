# 실제 화면 흐름

대상 소유권과 기기 승인, 전체 실행은 [네이티브 개발 검수](../docs/qa/native-development.md)를 따른다. 계약 테스트나 YAML 파싱을 실제 화면 통과로 세지 않는다.

## Android 공개 계정 입력 canary

`--scope solo --authoring --flow account-input-canary`는 로컬 Firebase의 승인된 `com.seorilabs.cyclepair.qa`만 허용한다. controller가 고정 공개값을 child 전용 환경변수로 전달한다. 외부 입력과 다른 흐름의 동시 실행을 허용하지 않는다.

홈에서 설정과 계정으로 이동하고 게스트와 비어 있는 입력3칸을 먼저 확인한다. 이메일, 비밀번호와 확인란을 실제로 누르고 입력한다. 같은 입력 ID에 이메일 표시와 secure 필드의 마스킹 길이를 대조한다. 제출 없이 닫고 다시 열어 세 칸이 비어 있는지 확인한 뒤 홈으로 돌아온다. 입력 ID3개는 테스트용 속성이며 동작과 접근성 이름을 바꾸지 않는다.

비밀번호와 확인란은 마스킹 길이까지만 확인한다. 값의 정확한 일치나 인증 성공을 증명하지 않는다. 결과의 `canaryScope`는 비밀번호 정확입력, 인증 성공과 제출을 false로 유지한다. 실제 계정 인증 흐름은 별도로 구현하고 실행해야 한다.

빈칸은 placeholder 선택자로 판정하지 않는다. 각 칸을 화면으로 스크롤한 뒤 보호된 localhost 채널이 QA 전면 상태와 고정 입력 ID 하나의 UI 트리 `text`가 비었는지만 관찰한다. 전면 앱이 다르거나 ID가 없거나 중복되면 거절한다. UI 원문은 stdin과 메모리에서만 처리하고 파일, 로그와 클립보드에 남기지 않는다. 호스트에 Python3가 필요하다. controller는 OS가 고른 포트 하나를 소유 Maestro의 `--driver-host-port`와 observer에 같은 값으로 전달한다. 기존 ADB 5037의 승인된 단일 serial을 통해 그 실행의 `viewHierarchy`만 읽으며, endpoint가 없으면 거절한다. 고정7001이나 포트 탐색으로 대체하지 않는다. 별도 UiAutomation, 서버 시작, 목록 조회와 포트 전달을 만들지 않는다. 오류와 취소 시 자신이 연 socket과 parser process group만 닫는다. 가짜 프로토콜 검사는 실제 동시 실행 호환성을 증명하지 않는다. [Maestro 2.11의 실제 포트 선택](https://github.com/mobile-dev-inc/Maestro/blob/v2.11.0/maestro-cli/src/main/java/maestro/cli/command/TestCommand.kt#L491-L502)을 따른다.

각 입력 검사와 닫기, 재열기, 빈칸 복원 뒤에는 `CP_ACCOUNT_CANARY stage=...`만 출력해 마지막 통과 단계를 구분한다. 이메일, 비밀번호와 계정 식별자는 출력하지 않는다.

값은 CLI 인수와 결과에 남기지 않는다. 출력 stream을 모두 읽어 가린 뒤 저장하고, 자동 화면과 원시 Maestro 자료는 임시 폴더와 함께 지운다. 이 흐름은 스크린샷을 보존하지 않는다. 실패 시 자동 재실행하지 않는다. 실패 화면을 먼저 확인하고, 공개값을 입력한 것이 확인된 경우에만 정상 뒤로 가기로 닫아 입력 정리를 확인한다. 기존 입력이 있으면 덮어쓰거나 지우지 않는다.

구현 검증은 Node 계약 검사와 캐시된 Maestro parser를 사용한다. 실제 Android 입력 실행에는 별도 GO가 필요하며, 작성자 실행은 공식 UI 회차와 전체 L3 통과가 아니다.

선택자 기준: [Maestro assertVisible](https://docs.maestro.dev/reference/commands-available/assertvisible), [복합 선택자의 AND 조건](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/how-to-use-selectors).

화면 관찰 기준: [Maestro 2.11 UI 서비스](https://github.com/mobile-dev-inc/Maestro/blob/v2.11.0/maestro-android/src/androidTest/java/dev/mobile/maestro/MaestroDriverService.kt), [고정 읽기 응답 규약](https://github.com/mobile-dev-inc/Maestro/blob/v2.11.0/maestro-proto/src/main/proto/maestro_android.proto), [gRPC 메시지 프레임](https://grpc.github.io/grpc/core/md_doc__p_r_o_t_o_c_o_l-_h_t_t_p2.html).

## Android 계정 인증 흐름

`account-upgrade,account-logout,account-login,account-reauthenticate`는 위 순서의 일부 또는 전체를 로컬 QA의 SOLO authoring으로만 실행한다. 전환은 게스트의 빈 입력에서 시작한다. 로그아웃은 취소와 확인, 재실행 뒤 로그인 화면을 확인한다. 로그인은 제출 뒤 홈과 재실행 복원을, 재인증은 새 성공 안내와 비밀번호 입력 비움을 확인한다. 로그인과 재인증의 빈값 관찰은 기존 고유 접근성 이름, EditText와 password 속성까지 고정해 읽는다. 제품의 계정 처리와 SDK를 호출해 UI를 건너뛰지 않는다.

같은 후보의 공개 `account-input-canary`를 먼저 실행한다. 새 manifest에는 `accountOwnershipPath`, `artifactPath`, `artifactSHA256`, `installedArtifactSHA256`, `installedArtifactReadbackInThisRun`, `candidateSourceSha`와 `nativeArtifactBuildSourceSha`를 적는다. `accountOwnershipPath`는 실제 해당 기기의 소유 UID를 확인한 새0600 파일이다. `app: cycle-pair`, `backend: emulator`, `platform: android`, `syntheticOnly: true`, `appId`, `deviceId`, `uid`가 필요하다. 기존 여러 UID의 합계로 한 계정을 추정하거나 기존 원장과 manifest를 덮어쓰지 않는다.

공개 흐름의 `account-canary-receipt.json`은 모든 공개 단계, 단일 PASS와 정리가 끝난 뒤에만 통과한다. 후보 SHA, manifest와 단일 소유 계정 파일, 설치와 대조한 APK, 캐시 Maestro의 launcher와 JAR들, 공개 및 인증 YAML의 지문을 묶는다. 실패, 다른 목적, 새 후보, 오래된 근거, 변경된 도구와 미정리 상태는 거절한다. 이 receipt는 공개 이메일의 정확 표시와 비밀번호 마스킹 길이만 증명하며 비밀번호 정확 입력과 인증 성공은 false다.

인증 실행에는 `--android-account-input-validation <같은조건의receipt>`와 `--android-account-input <외부0600파일>`, `--private-root <0700작업공간>`을 지정한다. 입력 JSON은 `kind: account`, `email`, `password` 세 필드만 가진다. 값 대신 파일 경로만 CLI에 적으며, receipt를 검증한 뒤에만 파일을 읽고 자식 전용 환경변수로 전달한다. 파일과 원장은 같은 소유 작업 공간 안의 일반 파일이어야 하며 symlink를 거절한다. 실제 계정별 비밀번호는 실행 준비자가 메모리에서 만들어 비공개 파일로 관리하며 이 도구는 생성하지 않는다.

모든 계정 흐름은 안전 캡처도 보존하지 않는다. stdout과 stderr의 입력값, JSON escape와 축약 prefix를 가리고, 소유 Maestro process group 정리를 확인한 뒤 원시 임시 폴더를 지운다. 그룹을 정리하지 못하면 비공개 원본 위치를 남겨 실행을 실패시키며 통과 receipt를 발행하지 않는다. 외부 입력 파일의 보존과 마지막 정리는 생성자가 맡는다. 호스트 계약 검사와 모의 receipt 검사는 실제 인증 성공이 아니다. 새 후보의 실제 공개 입력과 인증은 별도 실행 근거가 필요하며 공식 UI 회차와 전체 L3는 계속 미완료다.

## Android 기록 메모 교체

`record`와 이를 포함하는 `solo-record-language`는 실행 중인 actor의 검증된 manifest에 있는 앱과 기기에 관찰 대상을 묶는다. 같은 소유 Maestro endpoint로 `record-note`의 실제 text가 비었는지만 읽는다. 기존 메모가 있으면 길게 누르고, 전체 선택이 보이지 않을 때 Android 선택 메뉴의 `More options` 또는 `옵션 더보기`를 연다. 전체 선택과 삭제 뒤 빈값 관찰이 모두 성공해야 새 합성 메모를 입력한다. 메뉴 누락, 중복 ID, 다른 전면이나 관찰 오류는 입력과 저장 전에 실패한다. hint로 빈값을 추측하거나 커서 위치를 가정하지 않는다. 로컬 QA와 기존 service manifest 경로를 지원하며 실제 기기 실행 권한은 실행별 승인 범위를 따른다.

이 변경의 모의 관찰 검사와 YAML 파싱은 실제 메모 교체 성공이 아니다. 새 후보에서 실제 저장과 재실행 복원을 별도로 확인해야 한다.
