# 뒤로 이동 점검

2026-10-25, 기준 소스 `139e9a05c4ed0f90fe8f1a45593cee06202c59a6`. 기기 호출은 0회다.

| 경로 | 확인 결과 | 처리 |
| --- | --- | --- |
| 최상위 | `goBack`이 false를 반환해 OS 기본 동작에 맡김 | 기존 정책 유지 |
| 설정, 초대, 공유 | Store의 `GO_BACK` 단계 전환 존재, 관련 기존 시험 통과 | 온보딩의 방문 이력과 통합 |
| 오늘 기록 | 일반 뒤로 이동은 기록 화면만 닫음 | 기존 당일 초안 유지 |
| 오늘 기록 저장 중 | 화면 취소 버튼은 disabled지만 부모 BackHandler는 `backendBusy`를 확인하지 않고 닫음 | 저장 중에는 두 경로 모두 이탈 차단 |
| 시작 설정 재진입 | 컨디션만을 선택한 뒤 화면을 떠났다 돌아오면 기존 `state.isLogger` 값으로 초기화 | 온보딩 초안의 상태와 수명 명시 |
| 초대 하위 단계 | 화면 안의 이전은 방향 선택으로 이동하지만 시스템 뒤로 가기는 전체 초대를 종료 | 같은 한 단계 뒤로 이동 처리 사용 |
| 설정 상세, 선택 시트 | 각 Modal에 `onRequestClose` 존재 | 실제 이벤트와 변경 있는 편집 취소를 구현 단계에서 추가 검수 |
| 공동 일정 편집 | 닫을 때 `eventDraft=null`로 미저장 편집을 버림 | 변경이 있으면 버리기 확인을 설계에 포함 |

개발 환경에서 실제 `CyclePairApp`, `SetupScreen`, `InviteScreen`과 BackHandler 리스너를 실행했다. Store 및 외부 화면 일부를 테스트 대체 구현으로 격리했다. 루트 위임, 일반 기록 닫기, 저장 중 이탈, 설정 선택 소실, 초대 하위 단계 이탈의 5개 관찰 검사를 통과했다. 여기서 통과는 현재 동작의 재현이며 결함이 고쳐졌다는 뜻이 아니다. 별도로 기존 Store와 공용 UI 시험 26개를 통과했다.

초기 관찰 도구는 Jest factory의 import 제한과 fixture의 날짜 누락으로 실패했다. 도구만 수정해 실제 앱 소스 변경 없이 재실행했다. 최초 실패와 최종 실행을 함께 보존한다. 실제 키보드, Android 시스템 애니메이션, iOS 가장자리 제스처는 실행하지 않았다. 원본 실행 기록과 관찰 시험 소스는 NAS 증적 목록에서 확인한다.

## 실행 기록

`node node_modules/jest/bin/jest.js --config apps/mobile/jest.config.js --runInBand --runTestsByPath apps/mobile/src/backNavigation.audit.test.tsx apps/mobile/src/app/CyclePairStore.test.ts apps/mobile/src/components/Ui.test.tsx`

최종 결과는 3개 묶음, 31개 통과다. 관찰 시험 파일은 실행 후 원본 증적으로 보존하고 제품 소스에서 제거했다. 공유 의존성을 임시 링크로 재사용했으며 lockfile, 모바일 package.json, Babel 및 Jest 설정의 동일성을 확인했다. 시험의 소스와 제품 코어 매핑은 이번 기준 소스를 사용했다.

계정 화면을 추가하기 전 설계 HTML은 작성자 확인 15개를 실행했다. 실제 앱 전체 회귀와 독립 검수 3회는 아직 실행하지 않았다. 큰 글자 확인 도구는 처음에 상속 글자 크기를 중복 확대하여, 원래 계산된 글자 크기를 먼저 수집한 뒤 두 배로 적용하도록 도구만 고쳤다. 계정 우선 흐름의 후속 확인은 별도 실행 기록을 따른다.

원본 49개, 1,498,598바이트의 NAS 목록: `/Volumes/Data/Backup/agent-artifacts/cycle-pair/2026-10-25/139e9a05c4ed0f90fe8f1a45593cee06202c59a6/onboarding-design-131107-4824df/VERIFIED-MANIFEST.json`

SHA256: `e75893b235fd5841a3f30250b173fe0dbea39345687ae5e1ee86c5dcf73ce436`. 직접 읽어 크기와 해시를 확인한 뒤 작업 전용 로컬 실행 기록과 화면을 제거했다. 설계 HTML과 문서는 Git 원본으로 유지한다.
