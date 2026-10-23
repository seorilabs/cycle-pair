# 네이티브 실제 기기 실행

2026-10-22 사용자 지시로 연결된 Android와 iPhone에서 테스트한다. [테스트 계획](../design/2026-10-22-native-launch/test-plan.json)의 L3 전체 회귀, 독립 검수 3회와 두 마켓 공개 범위는 유지한다. Simulator와 AVD는 사용하거나 다운로드하지 않는다. 실행기는 Android에 Maestro 2.11과 adb, iPhone에 별도로 서명한 XCTest를 선택한다. iPhone을 Maestro나 Simulator로 대체하지 않는다.

## 설치와 자료 보존

등록된 기존 Firebase 설정과 서명 자료를 재사용한다. 연결 기기의 기존 설치, 버전과 계정 상태를 먼저 확인한다. 앱을 제거하거나 자료를 초기화하지 않는다. 기존 계정과 기록이 있는 설치를 합성 테스트용이라고 표시하지 않는다. 다른 연결 설정의 계정이나 캐시가 있으면 앱의 시작 차단을 유지하고 기존 자료를 보존한다.

물리 Android는 `adb install -r`로 설치를 갱신한다. 서명이 다르면 기존 설치를 제거해서 우회하지 않는다. 연결 Android에서 기존 Play 서명의 보관 자료와 Debug 서명 불일치를 확인했으므로 로컬 검수에는 `pnpm build:android:synthetic`으로 만든 `com.seorilabs.cyclepair.qa`를 사용한다. 이 설치는 이름이 Cycle Pair QA이고 운영 서버 시작을 차단한다. 기존 앱의 자료와 서명을 바꾸지 않으며 새로운 Firebase 앱이나 운영 리소스를 등록하지 않는다. 임시 Firebase 클라이언트 실행 사본은 빌드 후 제거한다. 테스트 APK는 `apps/mobile/android/app/build-synthetic/outputs/apk/debug/app-debug.apk`에 생성한다. 실제 Platform 인증과 원격 푸시는 원래 패키지의 정확한 서명 후보로 별도 검수한다.

iPhone은 기존 개발 인증서와 해당 UDID가 포함된 기존 프로파일로 빌드한다. Simulator 바이너리는 설치하지 않는다. 새 자격증명이나 프로파일은 만들지 않는다.

## 로컬 Firebase와 실제 서비스

로컬 Firebase는 가상 휴대폰이 아닌 테스트 서버다. `pnpm start:emulators`와 `CYCLEPAIR_DEV_BACKEND=emulator pnpm start:mobile`을 별도 터미널에서 실행한다. 실제 Android의 localhost에서 Mac에 접근하도록 adb reverse로 Metro8081, Auth9399, Firestore8380, Functions5301을 연결한다. 기존 포트 연결이 있으면 보존하며 다른 목적의 연결을 덮지 않는다. 임시 `.env.local`이나 `.secret.local`도 기존 파일을 덮지 않는다. 서버는 운영 자격증명을 사용하지 않고 테스트 함수의 외부 네트워크를 차단한다.

ADB 서버가 종료되면 역방향 연결도 사라진다. 기존 서버가 없으면 별도 터미널에서 `adb nodaemon server`를 유지한 뒤 실행한다. 이미 사용 중인 서버를 재시작하거나 종료하지 않는다. 작업이 끝나면 이번 작업이 시작한 프로세스만 정리한다. Firebase SDK의 localhost 자동 변환은 Debug 라이브러리 설정에서 끈다. 실제 생성된 Debug 설정에는 해당 플래그가 있고 Release에는 없음을 확인하며, 저장소의 원래 `firebase.json`은 바꾸지 않는다.

실제 iPhone은 개발 번들을 제공한 Mac의 사설 IPv4 주소로 로컬 Firebase에 연결한다. 두 기기는 같은 로컬 네트워크에 있어야 한다. Mac에 할당된 주소를 명시해 `pnpm start:emulators --device-host <Mac의 사설 IPv4>`로 실행한다. 실행기는 지정한 인터페이스의 Auth9399, Firestore8380과 Functions5301만 기존 loopback 서버로 전달하며 종료 시 연결을 닫는다. 모든 인터페이스, 외부 주소나 할당되지 않은 주소는 거절한다. Android의 기존 adb reverse 경로는 그대로 사용한다. 소유 스냅샷을 재개할 때는 `--import <소유 스냅샷>`을 함께 적는다.

iPhone 앱에는 같은 Mac의8081 포트에서 `CYCLEPAIR_DEV_BACKEND=emulator pnpm start:mobile`로 제공한 번들을 연결한다. 로컬 네트워크 목적 문구는 Debug 설정에서 생성된 plist에만 추가한다. Release는 기존 plist와 실제 서비스 런타임을 사용하며 개발 번들 주소로 로컬 서버를 선택하지 않는다. 실제 iPhone의 서버 연결과 화면 실행은 이 설정 구현 및 단위 검사와 별도로 증명한다. 기존 Android 실행을 iPhone 통과로 취급하지 않는다. [Apple의 plist 생성 규칙](https://developer.apple.com/documentation/bundleresources/managing-your-app-s-information-property-list)과 [로컬 네트워크 개인정보 지침](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)을 따른다.

실제 서비스에는 `CYCLEPAIR_DEV_BACKEND=service`를 사용하며 실행별 전용 계정, 합성 자료와 생성 식별 목록이 준비된 뒤 실행한다. 실제 계정 자료를 테스트에서 변경하지 않는다.

로컬 Firebase 모드에서는 선택적 동의나 알림 설정을 켜도 운영 분석, 오류 수집, FCM과 Presence를 시작하지 않는다. Firebase가 제공하지 않는 이 로컬 기능은 격리된 구현으로 조립하며 원격 알림 허용 상태도 통과 처리하지 않는다. 로컬 인앱 알림과 실제 서비스의 원격 푸시 검수는 구분한다. 출시 경로는 실제 서비스 구현을 사용한다.

## 실행 대상과 결과

저장소 밖 비공개 JSON에 대상과 승인 범위를 기록한다. 아래 `appData: synthetic`은 설치 상태를 확인한 뒤에만 기입한다. 자동 실행기는 자료 초기화를 허용하지 않는다.

```json
{
  "app": "cycle-pair",
  "backend": "emulator",
  "adb": "<Android SDK>/platform-tools/adb",
  "runtimes": [
    {"platform": "android", "kind": "physical", "deviceId": "<approved connected serial>", "appId": "com.seorilabs.cyclepair.qa", "createdFor": "cycle-pair-native-launch", "authorized": true, "appData": "synthetic"}
  ]
}
```

```sh
JAVA_HOME=<JDK17> pnpm test:e2e:dev --scope solo --ownership <실제기기.json> --output <저장소밖/결과폴더> --maestro <Maestro실행파일>
JAVA_HOME=<JDK17> pnpm test:e2e:live --scope solo --ownership <서비스기기.json> --output <저장소밖/결과폴더> --maestro <Maestro실행파일>
```

작성 중에는 `--authoring`, 특정 여정 재현에는 `--flow record-restored,language`를 사용한다. 기존 합성 자료를 읽는 재현은 `--run-id`로 원래 실행 ID를 지정한다. 커밋하지 않은 작성자 실행은 출시 검수 근거가 아니다.

혼합 두 사용자 실행은 Android를 `runtimes[0]`, iPhone을 `runtimes[1]`에 적는다. iPhone runtime에는 `allowAppDataReset: false`를 명시하고, manifest 최상위에는 실제 설치와 Metro의 동일 후보인 `installedSourceSha`와 비공개 iPhone 계정 소유 목록의 절대 경로 `accountOwnershipPath`를 추가한다. 선언만 바꾸지 말고 실제 빌드, 설치와 실행 설정을 먼저 대조한다. manifest, 계정 목록, signed `.xctestrun`과 결과는 소스 트리 밖 같은 비공개 작업 공간에 두며 파일은 0600으로 제한한다.

```sh
pnpm test:e2e:dev --scope pair --ownership <비공개작업공간/두기기.json> --output <비공개작업공간/새결과폴더> --private-root <비공개작업공간> --maestro <Maestro실행파일> --ios-xctestrun <비공개작업공간/signed-build/도우미.xctestrun>
```

전체 명령의 첫 안내는 두 계정이 첫 안내에 있다는 선행 조건이다. 기존 계정을 초기화해 맞추지 않는다. 기존 홈에서 연결만 재현하려면 `--authoring --flow pair --run-id <두계정의원래실행ID>`를 함께 사용한다. iPhone만 공개 입력을 확인할 때는 iPhone runtime 하나와 `--scope solo --authoring --flow invitation-canary`를 사용하며 Maestro 인수는 필요 없다.

혼합 연결 실행은 실제 초대를 만들기 전에 iPhone 초대 입력란에 공개 문자열을 넣고 닫는 시험을 먼저 수행한다. 같은 후보, manifest와 signed 도우미의 1 PASS, 0 FAIL, 0 SKIP 및 원시 파일 정리가 확인돼야 실제 초대를 입력한다. 이 결과는 `result.json`이며 재개할 때만 `--ios-input-validation <같은조건의result.json>`으로 지정한다. 초대는 Android의 실제 화면에서 읽어 메모리로 전달하고 private `.xctestrun`에만 넣는다. XCTest가 출력한 입력 activity는 가린 로그와 원시 해시만 보존하고 원시 결과와 임시 plist는 제거한다. iPhone에서 자동 첨부는 모두 끈다. 두 기기의 단계별 결과와 XCTest 요약은 같은 실행 원장에 남는다.

Maestro의 Android 문자 입력과 내부 붙여넣기는 선택한 키보드 언어에 따라 영문을 자모로 입력할 수 있다. 사전 확인으로 기존 영문 입력 subtype을 확인한 경우에만 해당 runtime에 `keyboard: {"inputMethod": "<기존 IME ID>", "asciiSubtype": "<관찰한 영문 subtype 정수>"}`를 추가한다. 실행기는 기본 키보드 앱을 바꾸지 않으며 시작 당시 subtype을 보존하고 완료, 실패와 SIGINT 또는 SIGTERM 중단 뒤 복원한다. 모르는 값이나 다른 기본 키보드이면 변경하지 않고 중단한다. 기록은 저장 전에 입력 원문도 검사한다. 새 키보드를 설치하지 않는다.

`executedScenariosPassed`는 실행한 여정만 설명한다. 현재 실행기는 전체 L3 통과를 선언하지 않고 `passed: false`를 유지한다. 미실행인 계정 복구와 삭제, 초대 만료와 재사용, 실제 원격 푸시와 접근성을 추가로 실행해야 한다. 독립 검수는 별도 사전 계획과 후보 SHA를 남긴 뒤 시작한다.

초대 코드와 토큰, 비밀번호는 캡처와 결과에 남기지 않는다. 자동 실패 캡처는 비공개 임시 폴더에서 처리한 뒤 제거하고, `safe/`로 명시한 합성 화면만 보존한다. 비행기 모드 검수는 원래 설정을 기록하고 짧게 통신을 끊은 뒤 반드시 복원한다. 계정 복구와 삭제는 실행 목록으로 소유권을 확인한 전용 테스트 계정만 대상으로 한다. 실제 원격 푸시는 해당 서명 빌드의 수신과 알림 진입으로 증명하며 개발 APNs와 production APNs를 구분한다.

## 가상 기기 정리

다운로드한 iOS 런타임18.1, 26.2, 26.5, 27.0, 이번 작업의 iOS 가상 기기2개, Android AVD1개와 Simulator 빌드 캐시를 삭제했다. SDK의 Android 시스템 이미지는 없었고 emulator 도구도 제거했다. `simctl runtime list`가 비어 있고 이미지와 도구 경로가 없는 것을 재확인했다. Android 이미지 복원 제안은 취소했다. 기존의 다른 가상 기기 자료는 임의로 초기화하지 않았다.

작은 실패 원본과 합성 Firebase 스냅샷은 보존했다. 정리 전후 목록과 실제 가용 공간 차이는 저장소 밖 `evidence/simulator-cleanup.json`에 남긴다. 이전 Simulator 검수 결과는 당시 실행 근거로 보존하며 실제 기기 통과로 바꾸지 않는다.

## 실행에서 발견한 결함

- 최초 API36 환경은 소프트웨어 렌더러와 부족한 메모리로 Launcher가 응답하지 않았습니다. 원본 OS 오류를 보존한 뒤 같은 소유 AVD를 GPU host로 재기동했습니다.
- iOS 초기 번들 생성과 Maestro driver 시작 오류를 앱 결과와 구분해 보존했습니다. 공식 자동 기동 경로를 사용하며 이전 실행이 남긴 전용 XCTest helper를 정확히 확인해 정리합니다. 수동 helper와 CLI의 자동 선택 포트가 달라지는 재사용 설정은 사용하지 않습니다.
- 실제 Android 저장에서 모바일 daily schema2와 서버 규칙 schema3의 불일치를 재현했습니다. 서버 규칙을 유지하고 모바일 쓰기를 schema3으로 맞췄습니다. 기존 대기 기록을 지우지 않고 재전송과 재실행 복원을 확인합니다.
- 개발용 내보내기가 운영 주소를 만드는 문제를 발견했습니다. Emulator 주소는 로컬 호스트로 제한하고 출시 경로는 HTTPS 검사를 유지합니다.

독립 UI 검수 회차는 작성자 점검과 구분해 원본 판정, 후보 SHA, 실행 환경과 시각을 남깁니다. 3회가 끝난 뒤 미해결이 있으면 추가 회차 전에 사용자에게 범위와 비용을 알립니다.

최근 구현 중간 결과와 원본 실패, 마켓 재조회는 [2026-10-22 기록](2026-10-22-native-authoring-status.md)에 정리합니다. 승인된 [iOS 저장 패치와 보존 이관](../design/2026-10-22-native-launch/keychain-repair.md)을 적용했고, 기존 설치를 지우지 않은 재실행과 원문 복원을 작성자가 확인했습니다. JavaScript만 갱신한 이전 네이티브 바이너리는 시작을 거부하므로 네이티브 앱도 재빌드해야 합니다. 독립 UI 검수는 시작하지 않았습니다.

검수 대기 중에는 소유 Emulator 자료를 저장소 밖으로 내보내고 `cyclepair-qa-owned.json`에 `app: "cycle-pair"`, 해당 `projectId`, `syntheticOnly: true`를 기록합니다. 재개는 `pnpm start:emulators --import <소유 스냅샷>`을 사용합니다. 실행기는 이 표식과 Firebase 내보내기 메타데이터를 확인하며, 다른 앱 자료와 저장소 안 스냅샷을 거부합니다. 이 명령은 운영 Firebase에 자료를 복원하지 않습니다.
