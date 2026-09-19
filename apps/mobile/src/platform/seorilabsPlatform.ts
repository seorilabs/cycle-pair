/**
 * Seorilabs Platform 연동이 공유하는 상수.
 *
 * 게스트 자격증명과 Presence heartbeat가 같은 host·appId를 써야 Platform
 * registry가 두 경로를 한 앱으로 본다. 값이 갈리면 registry readback에서만
 * 드러나므로 한 곳에 둔다.
 */
export const SEORILABS_PLATFORM_API_BASE_URL =
  'https://platform-api-306278488979.asia-northeast3.run.app';

export const SEORILABS_PLATFORM_APP_ID = 'cycle-pair';

/**
 * Platform에 알리는 출시 버전. `apps/mobile/package.json`의 version과 같은
 * 값을 쓴다. 번들러가 package.json을 읽지 않으므로 여기서 선언한다.
 */
export const SEORILABS_PLATFORM_APP_VERSION = '1.0.4';
