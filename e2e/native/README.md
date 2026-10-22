# 이전 iOS 대기 기록 준비

`LegacyPendingFixture.m`은 출시 앱에 포함하지 않는 Simulator 전용 검사용 앱이다. Cycle Pair 내부 함수를 호출하지 않고 이전 RNKeychain과 같은 속성의 합성 대기 기록1개를 만든다. 실제 사용자 입력으로 준비한 자료로 세지 않는다.

## 사전 조건

- 사용자 자료가 없는 소유 Simulator와 로컬 Firebase만 사용한다. `SIMULATOR_UDID`가 비공개 준비 파일의 `deviceId`와 일치해야 한다.
- 해당 합성 사용자의 기존 기록이 없는 날짜를 고르고 새 `mutationId`를 쓴다. 기존 날짜와 대기 기록을 덮어쓰지 않는다.
- 비공개 `fixture.json`에 `app: "cycle-pair"`, `syntheticOnly: true`, `deviceId`, `operation: "seed"`, `service`, `username`, `password`를 둔다. 파일은0600, 상위 폴더는0700으로 만든다.
- `username`은 해당 합성 UID, `password`는 실제 앱의 schema1 대기 기록 JSON 원문이다. 계정 비밀번호가 아니다. `createdAt`은 앱과 같은 밀리초3자리 UTC 형식이어야 한다. `service`는 `offline.v1.` 뒤에 앱의 SHA256 축약 규약을 적용한다.

준비 파일과 실제 UID, 원문은 저장소와 로그에 넣지 않는다. 도구는 기존 항목이 있으면 덮어쓰지 않고 중단한다. 생성 후 원문을 다시 읽어 동일함을 확인하고 결과에는 상태와 원문의 SHA256만 적는다.

## 빌드와 실행

별도 `.app`에 이 소스의 실행 파일, APPL `Info.plist`와 비공개 `fixture.json`을 둔다. UIKit, Foundation, Security를 연결해 arm64 iphonesimulator로 컴파일한다. Simulator용 `__TEXT,__entitlements`에는 해당 검사용 bundle의 application identifier와 앱의 기존 Keychain accessgroup만 넣는다. 실제 Cycle Pair의 권한, 서명과 accessgroup은 바꾸지 않는다.

실제 앱과 같은 Simulator ad hoc 서명 형식을 사용한다. Simulator용 속성은 Mach-O에 포함하며 서명 명령에는 배포용 entitlement를 주입하지 않는다.

```sh
codesign --sign - --force --timestamp=none --generate-entitlement-der <검사용.app>
```

정확한 소유 Simulator에만 설치하고 실행한다. `Documents/result.json`의 `passed`, `seededCount: 1`, `legacyByteReadbackMatches`와 준비 파일의 SHA256을 대조한다. 실패는 실행 원본과 함께 보존한다.

## 실제 이관과 재전송

검사용 앱을 종료하고 정상 Cycle Pair를 시작한다. [실제 화면 여정](../flows/legacy-pending-restored.yaml)에 `PENDING_DATE`와 `SYNTHETIC_NOTE`만 전달해 달력 상세의 원문을 확인한다. 앱 함수 호출이나 서버 직접 쓰기로 성공을 만들지 않는다.

로컬 서버를 읽어 원문, `lastMutationId`와 schema3을 대조한다. 같은 준비 파일의 `operation`만 `verify-removed`로 바꿔 검사용 앱을 실행하면 이전 동기화 항목과 재전송한 기기 전용 대기 항목이 모두 없는지 확인한다. 서버 대조와 화면 확인을 함께 통과해야 재전송 성공이다.

결과를 비공개 근거 폴더에 보존한 뒤 검사용 앱만 제거한다. 실제 Cycle Pair를 삭제하거나 저장소를 초기화하지 않는다. 이 절차는 네이티브 저장 경계 검증이며 전체 L3와 독립 UI 검수를 대신하지 않는다.
