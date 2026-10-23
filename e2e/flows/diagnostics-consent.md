# Android 진단 동의 설정 점검

`diagnostics-consent.yaml`은 소유 합성 자료와 로컬 Firebase를 사용하는 Android QA 설치 전용이다. 기존 홈에서 시작하며 처음의 Switch 상태를 실제 UI로 읽고 반전, 재실행 유지, 원래 상태 복원과 재실행 유지를 확인한다. 앱 자료를 초기화하거나 SDK를 직접 호출하지 않는다.

실행은 조작권을 인계받은 뒤 기존 실행기로 `--backend emulator --scope solo --authoring --flow diagnostics-consent`를 선택한다. 소유 Android manifest와 저장소 밖 새 output, 기존 Maestro 경로를 지정한다. 현재 설치의 제품 SHA와 이 YAML을 실행한 test driver SHA를 각각 적고 공식 검수 회차는 0으로 기록한다. 전체 관측 기능이나 실제 Analytics와 Crashlytics 전달의 통과 근거는 아니다.

`CP_DIAGNOSTICS initial=true|false`는 실패 시 복원할 시작값이다. 실패하면 자동 재실행하지 않고 원본 FAIL을 보존한다. 마지막 `restored` 표시가 없으면 실행자는 같은 설정 화면의 현재 Switch를 읽어 시작값과 다를 때만 UI로 한 번 복원하고, 정상 재실행 뒤 같은지 확인해 별도 정리 결과를 남긴다. 복원을 못 하면 현재 상태와 차단 사유를 조율자에게 인계한다. 이 정리가 원래 실패를 통과로 바꾸지 않는다.

명시한 safe 캡처 3개는 진단 설정 화면만 대상으로 한다. 다른 앱 알림이나 민감 내용이 겹치면 보존 대상으로 올리지 않는다. 기존 실행기의 private 임시 출력과 가린 로그 처리, 자동 실패 캡처 제거를 사용하고 계정, 메모, 초대와 토큰은 수집하지 않는다. 원래 언어와 키보드, 이번 실행이 만든 reverse만 복원한다. ADB와 개발 서버는 종료하지 않는다.

확인한 공식 문서: [Switch의 checked 선택자](https://docs.maestro.dev/reference/selectors/state-selectors), [조건부 실행](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/conditions.md), [evalScript와 output](https://docs.maestro.dev/maestro-flows/javascript/run-and-debug-javascript.md). 이 문서와 정적 검증은 실제 UI 실행 통과를 뜻하지 않는다.
