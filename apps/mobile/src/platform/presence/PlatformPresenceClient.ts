import { createPlatform } from '@seorilabs/platform-sdk';
import { Platform as ReactNativePlatform } from 'react-native';

import {
  SEORILABS_PLATFORM_API_BASE_URL,
  SEORILABS_PLATFORM_APP_ID,
  SEORILABS_PLATFORM_APP_VERSION,
  SEORILABS_PLATFORM_RUNTIME,
} from '../seorilabsPlatform';
import { noopPresenceClient, type PresenceClient } from './PresenceClient';

/**
 * Phase A는 탑재까지만 한다.
 *
 * 켜는 것은 Platform registry의 `features.presence`와 같은 릴리스에서 짝지어
 * 해야 하는 별도 gate라, 기본값은 꺼짐이다. 여기를 true로 바꾸는 변경은
 * registry 변경과 함께 올라가야 한다.
 */
const PRESENCE_ENABLED_BY_DEFAULT = false;

export interface PlatformPresenceClientOptions {
  enabled?: boolean;
  fetchImpl?: typeof fetch;
}

function presencePlatform(): 'android' | 'ios' {
  return ReactNativePlatform.OS === 'ios' ? 'ios' : 'android';
}

/**
 * Presence 경로의 어떤 실패도 호출자에게 전파하지 않는다.
 *
 * SDK가 heartbeat 안에서 이미 오류를 삼키지만, 조립·타이머 등록처럼 그
 * 바깥에서 나는 실패까지 fail-open으로 막아야 Edge 장애가 앱 시작을 건드리지
 * 않는다.
 */
function ignoringFailure(run: () => void): void {
  try {
    run();
  } catch {
    // Presence는 관측이다. 실패는 제품 흐름을 바꾸지 않는다.
  }
}

export function createPlatformPresenceClient(
  options: PlatformPresenceClientOptions = {},
): PresenceClient {
  const enabled = options.enabled ?? PRESENCE_ENABLED_BY_DEFAULT;
  let platform: ReturnType<typeof createPlatform>;
  try {
    platform = createPlatform({
      baseUrl: SEORILABS_PLATFORM_API_BASE_URL,
      appId: SEORILABS_PLATFORM_APP_ID,
      presenceEnabled: enabled,
      // 안정된 appId와 출시 버전만 보낸다. 사용자 ID·광고 ID·세션 ID 같은
      // 식별자는 Presence 경로에 올리지 않는다.
      // 게스트 자격증명 경로와 같은 runtime을 선언해 Platform이 이 앱의
      // 두 경로를 한 실행 환경으로 본다.
      clientContext: () => ({
        appVersion: SEORILABS_PLATFORM_APP_VERSION,
        runtime: SEORILABS_PLATFORM_RUNTIME,
      }),
      presenceContext: () => ({
        platform: presencePlatform(),
        appVersion: SEORILABS_PLATFORM_APP_VERSION,
      }),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  } catch {
    return noopPresenceClient;
  }

  // presence만 쓴다. platform.start()는 이벤트 전송까지 함께 켜므로 부르지
  // 않는다. Presence는 SDK 안에서 enabled가 false면 start()가 무동작이다.
  return {
    start: () => ignoringFailure(() => platform.presence.start()),
    stop: () => ignoringFailure(() => platform.presence.stop()),
    resume: () => ignoringFailure(() => platform.presence.resume()),
  };
}

export const platformPresenceClient = createPlatformPresenceClient();
