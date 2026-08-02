# 사이클 페어 AppsInToss

AppsInToss SDK 2.x의 React Native 0.84 + TDS 타깃이다. 임시 build appName은
`cycle-pair`, sandbox scheme은 `intoss://cycle-pair/`다. Console 앱 생성 시 가용성과
등록값을 대조하기 전에는 영구 ID로 확정하지 않는다.

## 현재 제공 범위

- 오늘의 컨디션과 원하는 배려를 정해진 선택지에서 고른다.
- 선택값은 AppsInToss `Storage`에 로컬 날짜와 함께 보관하고, 날짜가 바뀌면 자동 삭제한다.
- 사용자가 버튼을 누르면 공식 `share()`로 system share sheet를 연다.
- 주기 날짜, 증상, 자유 텍스트, 계정 식별자는 저장하거나 공유하지 않는다.

Firebase 로그인·Pair 연결·민감 주기 동기화·알림·구독은 이 build slice에서 제공한다고
표시하지 않는다. 해당 기능은 AppsInToss 정책과 Toss Login/App Check/backend adapter를
검증한 뒤 별도 구현한다.

## 명령

```bash
pnpm --filter @cyclepair/ait lint
pnpm --filter @cyclepair/ait typecheck
pnpm --filter @cyclepair/ait test
pnpm --filter @cyclepair/ait build
```

산출물은 `apps/ait/cycle-pair.ait`다. 릴리스 판정기는 AIT 포맷, `appName`, SDK/RN/TDS metadata, iOS·Android bundle과 payload hash를 검증한다. `.ait` 성공은 Console 등록, 정식 600x600 아이콘,
등록 이미지, 정책 승인, sandbox 실기기 QA 또는 배포 완료를 뜻하지 않는다.
