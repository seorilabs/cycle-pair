# 네이티브 개발 실행

현재 승인 범위는 [L3 테스트 계획](../design/2026-10-22-native-launch/test-plan.json)입니다. 물리 기기 대신 전용 Android 16 가상 환경과 iOS Simulator에서 실제 화면을 터치하고 입력합니다. Maestro 실행은 앱 내부 함수를 호출하지 않습니다.

## 준비

`pnpm install --frozen-lockfile` 후 등록된 앱의 Firebase 설정을 복원합니다. Android와 iOS 개발 빌드를 별도로 만들고, 사용자 자료가 없는 전용 환경에 설치합니다. Android 이미지는 기존 API36 ARM64를 재사용하며 새 AVD의 실제 할당량은 8GB 이하로 유지합니다. API36은 GPU host, RAM4GB, CPU4 설정에서 OS 응답을 확인했습니다.

터미널 하나에서 `pnpm start:emulators`, 다른 터미널에서 `CYCLEPAIR_DEV_BACKEND=emulator pnpm start:mobile`을 실행합니다. Emulator는 Auth9399, Firestore8380, Functions5301을 사용합니다. 임시 `.env.local`이나 `.secret.local`이 이미 있으면 덮어쓰지 않고 중단합니다. 운영 자격증명을 사용하지 않으며 테스트 함수의 외부 네트워크도 차단합니다.

실제 서비스는 별도의 테스트 설치본과 `CYCLEPAIR_DEV_BACKEND=service`를 사용합니다. 연결이 다른 계정과 캐시가 있으면 앱이 시작을 거부합니다. 기존 자료를 자동 삭제하거나 새 게스트로 덮지 않습니다.

## 소유 환경 목록

저장소 밖 비공개 JSON에 아래 구조를 적습니다. 두 사용자 여정에는 두 환경이 필요합니다. Android는 `emulator-` ID와 QEMU, iOS는 Booted 상태의 `CyclePair_` 전용 Simulator만 허용합니다. 연결 기기 목록을 조회하거나 물리 기기를 선택하지 않습니다.

```json
{
  "app": "cycle-pair",
  "backend": "emulator",
  "adb": "<Android SDK>/platform-tools/adb",
  "runtimes": [
    {"platform": "android", "deviceId": "emulator-5580", "createdFor": "cycle-pair-native-launch", "allowAppDataReset": true},
    {"platform": "ios", "deviceId": "<owned simulator UUID>", "createdFor": "cycle-pair-native-launch", "allowAppDataReset": true}
  ]
}
```

## 실행과 결과

```sh
JAVA_HOME=<JDK17> pnpm test:e2e:dev --ownership <소유환경.json> --output <저장소밖/결과폴더> --maestro <Maestro실행파일>
JAVA_HOME=<JDK17> pnpm test:e2e:live --ownership <서비스소유환경.json> --output <저장소밖/결과폴더> --maestro <Maestro실행파일>
```

작성 중에는 `--authoring`, 한 사용자에는 `--scope solo`, 특정 여정 재현에는 `--flow record-restored,language`를 사용합니다. 기존 합성 자료를 읽는 재현은 `--run-id`로 원래 실행 ID를 지정합니다. 커밋하지 않은 작성자 실행은 출시 검수 근거가 아닙니다.

결과의 `executedScenariosPassed`는 실행한 여정만 설명합니다. `unrun`이 남은 현재 실행기는 전체 L3 통과를 선언하지 않으며 `passed`를 false로 보존합니다. 계정 복구와 삭제, 만료 및 재사용 초대, 원격 푸시와 접근성 등의 승인 조건을 추가로 실행해야 합니다.

초대 코드는 화면에서 복사한 값을 실행기 메모리로만 두 사용자 사이에 전달합니다. 원본 명령 기록과 자동 실패 캡처는 비공개 임시 폴더에서 처리한 뒤 제거합니다. 보존하는 로그는 비밀값을 가리고, `safe/`로 명시한 합성 화면만 남깁니다. 초대, 토큰과 비밀번호를 캡처하거나 결과에 넣지 않습니다.

실제 서비스 자료는 실행별 전용 계정과 합성 기록만 사용하고 생성한 식별 목록에 한정해 정리합니다. 운영 푸시 수신은 단위 테스트나 Emulator 전달로 증명하지 않습니다. iOS Simulator APNs의 개발 서버 수신과 공개 빌드의 production APNs를 구분합니다.

## 실행에서 발견한 결함

- 최초 API36 환경은 소프트웨어 렌더러와 부족한 메모리로 Launcher가 응답하지 않았습니다. 원본 OS 오류를 보존한 뒤 같은 소유 AVD를 GPU host로 재기동했습니다.
- iOS 초기 번들 생성과 Maestro driver 시작 오류를 앱 결과와 구분해 보존했습니다. 공식 자동 기동 경로를 사용하며 이전 실행이 남긴 전용 XCTest helper를 정확히 확인해 정리합니다. 수동 helper와 CLI의 자동 선택 포트가 달라지는 재사용 설정은 사용하지 않습니다.
- 실제 Android 저장에서 모바일 daily schema2와 서버 규칙 schema3의 불일치를 재현했습니다. 서버 규칙을 유지하고 모바일 쓰기를 schema3으로 맞췄습니다. 기존 대기 기록을 지우지 않고 재전송과 재실행 복원을 확인합니다.
- 개발용 내보내기가 운영 주소를 만드는 문제를 발견했습니다. Emulator 주소는 로컬 호스트로 제한하고 출시 경로는 HTTPS 검사를 유지합니다.

독립 UI 검수 회차는 작성자 점검과 구분해 원본 판정, 후보 SHA, 실행 환경과 시각을 남깁니다. 3회가 끝난 뒤 미해결이 있으면 추가 회차 전에 사용자에게 범위와 비용을 알립니다.

최근 구현 중간 결과와 원본 실패, 마켓 재조회는 [2026-10-22 기록](2026-10-22-native-authoring-status.md)에 정리합니다. iOS 저장 라이브러리 패치는 사용자 확인 대기이며 독립 UI 검수는 시작하지 않았습니다.

검수 대기 중에는 소유 Emulator 자료를 저장소 밖으로 내보내고 `cyclepair-qa-owned.json`에 `app: "cycle-pair"`, 해당 `projectId`, `syntheticOnly: true`를 기록합니다. 재개는 `pnpm start:emulators --import <소유 스냅샷>`을 사용합니다. 실행기는 이 표식과 Firebase 내보내기 메타데이터를 확인하며, 다른 앱 자료와 저장소 안 스냅샷을 거부합니다. 이 명령은 운영 Firebase에 자료를 복원하지 않습니다.
