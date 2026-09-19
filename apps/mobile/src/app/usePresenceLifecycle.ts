import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { PresenceClient } from '../platform/presence/PresenceClient';

/**
 * Presence heartbeat를 앱 lifecycle에 건다.
 *
 * foreground 복귀에서 `start()`를 먼저 부르는 이유는, background에서 멈춘
 * 뒤에는 `resume()`만으로 다시 돌지 않기 때문이다. 이미 돌고 있으면 `start()`
 * 는 무동작이다.
 */
export function usePresenceLifecycle(presenceClient?: PresenceClient): void {
  useEffect(() => {
    if (!presenceClient) return;
    presenceClient.start();
    const subscription = AppState.addEventListener('change', status => {
      if (status === 'active') {
        presenceClient.start();
        presenceClient.resume();
        return;
      }
      presenceClient.stop();
    });
    return () => {
      subscription.remove();
      presenceClient.stop();
    };
  }, [presenceClient]);
}
