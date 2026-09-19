/**
 * RPI Edge 최근 활성 heartbeat.
 *
 * 제품 기능이 아니라 선택적 관측이다. 어떤 호출도 동기·비동기로 제품 흐름을
 * 막지 않고, Edge 장애를 호출자에게 전파하지 않는다. 그래서 모든 메서드가
 * Promise가 아닌 void를 돌려준다 — 호출부가 await할 수 있으면 안 된다.
 */
export interface PresenceClient {
  /** 즉시 반환한다. 비활성이면 아무 것도 하지 않는다. */
  start(): void;
  stop(): void;
  /** 앱이 foreground로 돌아왔을 때 호출한다. */
  resume(): void;
}

/** Presence를 쓰지 않는 조립에서 주입하는 무동작 구현. */
export const noopPresenceClient: PresenceClient = {
  start() {},
  stop() {},
  resume() {},
};
