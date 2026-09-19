/**
 * 로컬 도메인 계산에 쓰는 member 식별자.
 *
 * `CyclePairStore`와 `cycleViewModel`이 같은 `Cycle[]`을 만들어 같은 도메인
 * 함수에 넘기므로 두 곳이 같은 값을 써야 한다. `cycleViewModel`이
 * `CyclePairStore`의 타입을 import하고 있어 상수를 그쪽에 두면 순환이 생긴다.
 */
export const SELF_MEMBER_ID = 'local-self';
export const PARTNER_MEMBER_ID = 'remote-partner';
