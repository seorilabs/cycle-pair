import type {SubscriptionState} from './SubscriptionContext';

export function shouldShowSubscriptionEntry(
  state: Pick<SubscriptionState, 'salesEnabled' | 'subscription'>,
): boolean {
  return state.salesEnabled || state.subscription.status !== 'none';
}
