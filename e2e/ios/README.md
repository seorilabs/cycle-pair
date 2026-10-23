# iOS 실기기 XCTest 화면 실행

기존에 설치된 `com.seorilabs.cyclepair`를 실제 화면 요소로 조작하는 독립 UI 테스트 프로젝트다. 제품 앱의 Xcode 프로젝트와 배포 서명을 바꾸지 않으며, 계정이나 저장 파일을 직접 수정하지 않는다. 앱 설치와 첫 설정은 이 테스트의 선행 조건이며 테스트가 우회하지 않는다.

## 실행 범위

| XCTest 메서드 | 실제 화면에서 확인할 동작 |
|---|---|
| `testColdHomeExposesAccessibleControls` | 앱 종료와 실행, 홈 기록 버튼, 기본 탭의 접근성 이름과 누를 수 있는 위치 |
| `testLanguageChangeSurvivesColdRestart` | 설정에서 영어와 한국어 선택, 각 언어로 재실행 복원, 성공 시 원래 언어 선택으로 복귀 |
| `testRecordSurvivesColdRestart` | 감정과 원하는 도움 선택, 추가 입력 펼치기, 합성 메모 입력, 한 번에 저장, 재실행, 달력의 기록 상세에서 원문 확인 |

앱 내부 함수 호출, 직접 서버 쓰기, 앱 저장 자료 초기화, 로그인 우회는 없다. 메모는 실행 ID에 `-note`를 붙인 합성 문자열이다. 다른 메모가 이미 있으면 덮어쓰지 않고 실패한다. 테스트 실패 시 기록과 화면은 남으며 자동 삭제하거나 재설정하지 않는다. 언어 테스트가 도중 실패하면 마지막으로 선택한 언어가 남을 수 있다.

이 기본 접근성 검사는 접근성 트리의 이름, 버튼 종류, 실제 누를 수 있는 위치를 확인한다. 실제 VoiceOver 음성, 큰 글자, 전체 접근성 검사 또는 전체 회귀를 대신하지 않는다. 준비 빌드나 작성자 실행을 공식 독립 UI 검수 통과로 세지 않는다.

RN의 `screen-scroll`은 실제 iPhone에서 XCTest의 `Other` 요소로 노출될 수 있다. 스크롤 영역은 요소 종류를 제한하지 않고 식별자로 찾으며, 실제 스와이프 뒤 입력칸과 저장 버튼이 기기 창과 스크롤 영역의 겹친 범위 안에 있고 누를 수 있는지 검사한다. 화면별 하단 여백을 고정값으로 추정하지 않는다.

## 실행 전 조건

주 실행자가 해당 iPhone의 사용 승인, 잠금 해제, Developer Mode, UI Automation, 개발 이미지 연결 상태, 테스트 앱의 설치와 격리 계정을 확인한 뒤 인계한다. 이 프로젝트는 기기를 자동 검색하지 않는다. 실행 시 승인된 물리 iPhone UDID를 `-destination id=...`로 명시하며 대체 기기로 재시도하지 않는다.

프로젝트의 `SUPPORTED_PLATFORMS`는 `iphoneos`만 허용한다. Simulator로 빌드하거나 실행하는 경로는 제공하지 않으며 Swift 코드도 Simulator 실행을 거부한다.

## 기존 서명 자료와 최종 서명 범위

2026-10-22 로컬 준비에서 다음 기존 자료를 확인했다. 아래 값은 공개 서명 메타데이터이며 키와 비밀번호는 포함하지 않는다.

| 대상 | 기존 자료 |
|---|---|
| 개발 identity | catalog `shared/apple/development`, 팀 `HCDUXX4Z3X`, 인증서 SHA256 `DDEE08FAC5AC9BA6942958FAADCE58EED438795F83EDA08844614DB057F493B3` |
| Keychain signer SHA1 | `A4C6A63AFB22A60A93B569D0AF77A80D49797A1D` |
| 제품 앱 개발 profile | `6d98147e-0d17-4232-a183-cd7c595bedfc`, `iOS Team Provisioning Profile: com.seorilabs.cyclepair` |
| UI runner 개발 profile | `1d956cec-5b6a-4d39-823e-7f31623ee089`, `iOS Team Provisioning Profile: *` |

프로파일의 기존 로컬 경로는 `$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/<UUID>.mobileprovision`이다. 두 개발 프로파일은 승인된 iPhone을 포함하며 기존 개발 identity와 일치한다. 제품 앱 profile에는 개발 APNs와 App Attest가 있고, wildcard profile은 별도 UI runner의 기본 개발 서명에 사용한다. 다른 앱 전용 프로파일로 대체하지 않는다.

UI runner의 최종 bundle ID는 `com.seorilabs.cyclepair.physicalqa.xctrunner`다. 테스트 번들과 runner만 이 프로젝트에서 서명한다. 제품 앱은 별도 네이티브 빌드 산출물을 설치하고, 이 프로젝트에 제품 앱을 포함하거나 다시 서명하지 않는다. App Store 배포 profile은 Debug 직접 설치용으로 사용하지 않는다.

Xcode 27.1은 위 Xcode 관리 프로파일을 `CODE_SIGN_STYLE=Manual`로 지정하면 거부한다. 검증한 방식은 `CODE_SIGN_STYLE=Automatic`과 기존 팀을 지정하고, 기존 로컬 프로파일을 선택하는 것이다. `PROVISIONING_PROFILE`과 `PROVISIONING_PROFILE_SPECIFIER`를 강제하지 않는다. `-allowProvisioningUpdates`, `-allowProvisioningDeviceRegistration`을 넣지 않으므로 외부 프로파일 생성이나 기기 등록을 허용하지 않는다. 해당 로컬 자료가 없거나 실제 서명 identity가 달라지면 중단한다.

## 설치와 실행 없이 빌드 검증

저장소 루트에서 작업 전용 위치를 지정한다. 아래 명령은 기기에 설치하거나 테스트를 실행하지 않는다. 새 패키지나 runtime을 내려받지 않는다.

```sh
export CYCLEPAIR_QA_ROOT="/path/to/private/cycle-pair-qa"
xcodebuild build-for-testing \
  -project e2e/ios/CyclePairPhysicalUITests.xcodeproj \
  -scheme CyclePairPhysicalUITests \
  -configuration Debug \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$CYCLEPAIR_QA_ROOT/physical-ios-tests" \
  -disableAutomaticPackageResolution -skipPackageUpdates \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=HCDUXX4Z3X
```

이 방식으로 2026-10-22 빌드가 성공했으며, 결과 runner의 내장 profile UUID, 개발 인증서, iPhoneOS 플랫폼, `get-task-allow=true`, `codesign --verify --deep --strict`를 확인했다. 이 기록은 기기 실행 통과가 아니다. 서명 경로를 바꾸면 최종 runner의 동일 항목을 다시 확인한다.

## 인계 후 물리 iPhone 실행

테스트 프로세스는 다음 환경값을 모두 요구한다. 누락되면 앱 실행 전에 실패한다.

- `CYCLEPAIR_PHYSICAL_UI_APPROVED=1`: 현재 기기 사용 범위가 승인되었음을 주 실행자가 확인.
- `CYCLEPAIR_SYNTHETIC_INSTALLATION=1`: 설치 앱과 계정이 이번 실행의 합성 자료 전용임을 확인.
- `CYCLEPAIR_TEST_RUN_ID`: `cp-`와 숫자 17자리, 하이픈, 소문자 16진수 6자리 형식의 실행 ID.
- `CYCLEPAIR_CAPTURE_SAFE_SCREENS=1`: 선택 사항. 허용된 홈과 합성 기록 상세만 명시적으로 첨부. 기본은 첨부하지 않는다.

호스트 셸의 환경값이 기기의 XCTest 프로세스로 자동 전달된다고 가정하지 않는다. 생성된 `.xctestrun`을 **동일한 `Build/Products` 폴더**에 실행별로 복사하고 `EnvironmentVariables`에 값을 전달한다. `__TESTROOT__` 상대 경로가 유지되어야 한다. 현재 생성 형식의 대상 키는 `CyclePairPhysicalUITests`다.

```python
import os, pathlib, plistlib

source = pathlib.Path(os.environ["CYCLEPAIR_XCTESTRUN_SOURCE"])
run_id = os.environ["CYCLEPAIR_TEST_RUN_ID"]
data = plistlib.loads(source.read_bytes())
target = data["CyclePairPhysicalUITests"]
environment = target.setdefault("EnvironmentVariables", {})
for name in ["CYCLEPAIR_PHYSICAL_UI_APPROVED", "CYCLEPAIR_SYNTHETIC_INSTALLATION",
             "CYCLEPAIR_TEST_RUN_ID", "CYCLEPAIR_CAPTURE_SAFE_SCREENS"]:
    if name in os.environ:
        environment[name] = os.environ[name]
destination = source.with_name(source.stem + "-" + run_id + ".xctestrun")
with destination.open("xb") as file:
    file.write(plistlib.dumps(data))
destination.chmod(0o600)
```

기기 인계를 받은 주 실행자만 다음 명령을 실행한다. UDID와 실행별 `.xctestrun`, 결과 경로는 필수다. 이 명령은 runner를 설치하고 실제 앱을 종료, 실행, 조작한다. 자동 재시도나 자료 초기화 옵션을 추가하지 않는다.

```sh
xcodebuild test-without-building \
  -xctestrun "${CYCLEPAIR_XCTESTRUN:?}" \
  -destination "id=${CYCLEPAIR_IOS_DEVICE_ID:?}" \
  -parallel-testing-enabled NO \
  -maximum-concurrent-test-device-destinations 1 \
  -resultBundlePath "${CYCLEPAIR_UI_RESULT_BUNDLE:?}"
```

한 기능만 실행하려면 `-only-testing:CyclePairPhysicalUITests/CyclePairPhysicalUITests/testColdHomeExposesAccessibleControls`처럼 메서드를 명시한다. 전체 세 메서드의 통과도 승인된 전체 L3나 UI 검수 회차의 다른 항목을 면제하지 않는다.

결과 폴더는 0700, 파일은 0600으로 제한한다. XCTest 자체의 실패 첨부와 `.xcresult`에는 화면 내용이 포함될 수 있다. 원본은 비공개 위치에 보존하고, 공개 근거에는 허용 화면만 골라 복사한다. 로그인, 초대, 토큰 화면을 캡처하거나 전체 접근성 트리를 로그로 출력하지 않는다.

공식 참고: [Apple의 build-for-testing과 test-without-building](https://developer.apple.com/library/archive/technotes/tn2339/_index.html), [개발 프로파일](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile/), [Appium 실기기 준비 조건](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/device-setup/).
