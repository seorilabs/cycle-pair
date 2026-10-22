# Android 검수 이미지 복원 제안

상태: 미실행. 승인 계획의 기존 이미지 재사용 조건과 현재 환경이 달라 추가 확인이 필요하다. 실제 앱 자료와 AVD는 보존했다.

## 확인한 상태

2026-10-22 서비스 검수 환경 준비에서 기존 Android36 Google Play ARM64 이미지의 `package.xml`, `system.img`, `vendor.img`, `ramdisk.img`, `kernel-ranchu`가 SDK와 작업용 폴더 모두에 없었다. 기존 AVD가 참조한 네 이미지 파일도 부재한다. 원인과 삭제 시점은 확인하지 못했다. 새 AVD 생성은 실패했고 추가 자료는 만들지 않았다.

기존 AVD의 실제 할당량은3,005,599,744바이트다. 기존 기록과 암호화 저장소, 실패 원본과 로컬 Firebase 스냅샷을 보존했다.

## 복원할 대상

- 패키지: `system-images;android-36;google_apis_playstore;arm64-v8a`
- 이전에 사용한 revision6만 복원한다. 현재 공식 목록의 revision7로 바꾸지 않는다.
- [Google 공식 revision6 파일](https://dl.google.com/android/repository/sys-img/google_apis_playstore/arm64-v8a-36_r06.zip)의 HEAD 응답200과 다운로드 크기1,874,450,592바이트를 확인했다. 파일 본문은 받지 않았다.
- 대상 경로: `/Users/syous/Library/Android/sdk/system-images/android-36/google_apis_playstore/arm64-v8a`

## 실행 범위와 보존

1. 시작 직전에 위 대상이 여전히 없는지와 기존 AVD의 참조 경로를 다시 확인한다. 다른 작업이 이미 복원했으면 덮어쓰지 않고 읽기로 검증한다.
2. 위 공식 파일을 저장소 밖의 새 비공개 준비 폴더로 스트리밍 해제한다. 전체 압축 파일을 추가 보관하지 않고, 전송 SHA256과 ZIP 무결성, 경로, ARM64와 revision6을 확인한다. 링크나 상위 경로를 통해 준비 폴더 밖으로 쓰지 않는다.
3. 위 경로에 같은 이미지 파일만 복원한다. 다른 SDK, 전역 설정과 기존 AVD 자료는 바꾸지 않는다. 원래 AVD를 지우거나 초기화하지 않는다.
4. 기존 이미지를 사용하는 서비스용 AVD1개를 만든다. 이번 작업이 추가한 Android 이미지와 모든 AVD의 실제 할당량 합계를8GB(8,000,000,000바이트) 이하로 유지한다. 초과가 예상되면 시작하지 않으며 실행 중에도 확인한다.
5. 소유 가상 환경에서만 후속 개발 검수를 진행하고, 완료 후 이번 작업이 만든 가상 환경만 정리한다. 물리 기기는 사용하지 않는다.

이 복원은 앱 기능이나 출시 승인을 바꾸지 않는다. SDK 이미지의 재다운로드만 승인 계획의 기존 이미지 재사용 전제와 달라 추가 확인 대상으로 남긴다. 실제 서비스 연결 설정, 독립 L3와 UI3, 마켓 제출과 공개는 각각 별도 미완료 상태다.

원본 근거: 비공개 QA 폴더의 `evidence/service-android-source-image-blocker.json`, `evidence/service-android-avd-create.log`, `evidence/android-image-reinstall-proposal.json`.
