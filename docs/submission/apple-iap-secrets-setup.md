# Apple IAP / 구독 검증 secret 세팅 가이드 (초안)

> 목적: 구독 검증·App Store Server Notifications V2 Cloud Functions가 요구하는 secret 5종을 세팅하는 절차. **secret 값은 이 문서·로그·커밋에 남기지 않는다.** 로컬 source of truth는 `~/.config/seorilabs`.
> 근거: `firebase/functions/src/providers/subscriptionProviders.ts`의 `defineSecret` 5종과 `APPLE_IAP_SECRETS`.

## 요구되는 secret 5종

| Firebase secret | 내용 | 출처 |
| --- | --- | --- |
| `APPLE_IAP_KEY_ID` | App Store Server API 키의 Key ID | App Store Connect Server API 키 |
| `APPLE_IAP_ISSUER_ID` | Server API Issuer ID | App Store Connect |
| `APPLE_IAP_PRIVATE_KEY_BASE64` | Server API `.p8` 개인키 파일을 **base64로 인코딩**한 문자열 (코드가 `base64→utf8`로 복원) | `.p8` 파일 |
| `APPLE_APP_ID` | Cycle Pair의 **숫자 Apple ID**(App Store ID). `Number(...)`로 파싱되어 PRODUCTION verifier에 사용 | **App Store Connect 앱 생성 후에만 확정** |
| `APPLE_IAP_ROOT_CERTIFICATES_BASE64_JSON` | Apple Root CA 인증서(DER)를 base64한 문자열들의 **JSON 배열** (코드가 `JSON.parse`→각 항목 `base64→DER`) | Apple PKI 공개 인증서 |

> Google Play측은 Firebase secret이 필요 없다. `GooglePlayDeveloperApiProvider`가 Functions 런타임 서비스계정(ADC)으로 `androidpublisher` 스코프를 쓰므로, 대신 **그 SA를 Play Console에 연결하고 구독 조회 권한을 부여**해야 한다(Google Play 배포 blocker에서 다룸).

## 병목: `APPLE_APP_ID`

`APPLE_APP_ID`는 Cycle Pair의 숫자 App Store ID라 **App Store Connect에 앱을 먼저 생성**해야 나온다. 이 값이 없으면 구독 functions가 배포돼도 `providerUnavailable`로 동작하지 않는다. → 우선순위: App Store Connect 앱 생성이 이 가이드의 선행 조건.

## 로컬 자격증명 매핑 (확인 필요)

`~/.config/seorilabs/app-store-server-api.env`에 이미 다음이 있다(값은 확인만, 출력 금지):

- `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID` → Firebase 동명 secret에 그대로 사용 가능
- `APPLE_IAP_PRIVATE_KEY_PATH` → 가리키는 `.p8`을 base64하면 `APPLE_IAP_PRIVATE_KEY_BASE64`

**단 확인 필요**: 현재 `.p8`은 `~/.config/seorilabs/app-store-server-api/lizard-tycoon-iap.p8`로 **다른 앱(lizard-tycoon)** 것이다. App Store Server API 키가

- **team-level 키**라면 → 같은 Key ID/Issuer/개인키를 Cycle Pair에도 재사용 가능(앱 구분은 `APPLE_APP_ID`로). 이 경우 위 env 그대로 사용.
- **앱 전용(in-app) 키**라면 → Cycle Pair용 Server API 키를 새로 발급해 별도 `.p8`·Key ID·Issuer로 세팅.

App Store Connect → Users and Access → Integrations → In-App Purchase(App Store Server API)에서 키 범위를 확인해 둘 중 하나로 확정한다.

> 참고: `~/.config/seorilabs/app-store-connect.env`(`APP_STORE_CONNECT_*` + `AuthKey_*.p8`)는 **다른 용도**다. 이건 App Store Connect API(앱·메타데이터·빌드/TestFlight 업로드 자동화)용이며 구독 검증 secret과 혼동하지 않는다.

## Root 인증서 준비 (`APPLE_IAP_ROOT_CERTIFICATES_BASE64_JSON`)

Apple Root CA는 비밀이 아니다. https://www.apple.com/certificateauthority/ 에서 `AppleRootCA-G3.cer`(필요 시 `AppleRootCA-G2.cer` 포함)를 받아 각 DER을 base64한 뒤 JSON 배열로 만든다.

~~~bash
# 예: G3 루트 1개를 배열로. 값은 셸 변수로만 다루고 출력/커밋하지 않는다.
ROOTS_JSON=$(python3 - <<'PY'
import base64, json, pathlib
paths = ["AppleRootCA-G3.cer"]  # 필요 시 G2 추가
print(json.dumps([base64.b64encode(pathlib.Path(p).read_bytes()).decode() for p in paths]))
PY
)
~~~

## 세팅 절차 (App Store Connect 앱 생성 이후)

~~~bash
cd firebase
# 프로젝트는 운영 프로젝트로 교체(예: --project seorilabs-cyclepair-prod)
pnpm exec firebase functions:secrets:set APPLE_IAP_KEY_ID --project <PROJECT>
pnpm exec firebase functions:secrets:set APPLE_IAP_ISSUER_ID --project <PROJECT>

# .p8 → base64. 파이프로만 전달, 화면 출력 금지
base64 -i "$APPLE_IAP_PRIVATE_KEY_PATH" | pnpm exec firebase functions:secrets:set APPLE_IAP_PRIVATE_KEY_BASE64 --project <PROJECT> --data-file -

# App Store Connect에서 확인한 Cycle Pair 숫자 App Store ID
pnpm exec firebase functions:secrets:set APPLE_APP_ID --project <PROJECT>

# 위에서 만든 root 인증서 JSON 배열
printf '%s' "$ROOTS_JSON" | pnpm exec firebase functions:secrets:set APPLE_IAP_ROOT_CERTIFICATES_BASE64_JSON --project <PROJECT> --data-file -
~~~

세팅 후 구독 functions를 재배포하면 secret이 주입된다. dev에서도 동일 절차로 세팅해야 `test:firebase:live` 및 배포가 가능하다.

## 완료 판정

- 5개 secret이 대상 프로젝트에 존재하고 값이 비어있지 않다.
- 구독 관련 functions 배포가 secret 누락 없이 성공한다.
- (선택) sandbox 구매/알림으로 `verifyPurchase`·`verifyNotification`이 `providerUnavailable`을 던지지 않음을 확인한다.

### 확정 필요 목록
- App Store Connect 앱 생성 → `APPLE_APP_ID`(숫자)
- Server API 키의 team-level/앱전용 범위 확정, 필요 시 Cycle Pair용 키 발급
- 운영 프로젝트 ID(`<PROJECT>`)
- Google Play: Functions 런타임 SA의 Play Console 연결·구독 권한 부여
