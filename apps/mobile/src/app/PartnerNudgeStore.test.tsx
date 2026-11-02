import React from 'react';
import { act, render } from '@testing-library/react-native';
import { CyclePairProvider, useCyclePair } from './CyclePairStore';
import { previewCyclePairBackend } from '../platform/backend/PreviewCyclePairBackend';
import type {
  PartnerNudgeState,
  CyclePairBackend,
} from '../platform/backend/CyclePairBackend';

let current: ReturnType<typeof useCyclePair>;
let emit: (value: PartnerNudgeState) => void;
function Probe() {
  current = useCyclePair();
  return null;
}
const received = {
  requestId: 'nudge-one',
  pairId: 'nudge-pair',
  senderUid: 'partner',
  recipientUid: 'nudge-test',
  type: 'care-acknowledgement' as const,
  sentAt: '2026-11-02T00:00:00.000Z',
};
async function start(overrides: Partial<CyclePairBackend> = {}) {
  const backend: CyclePairBackend = {
    ...previewCyclePairBackend,
    initialize: async () => ({ uid: 'nudge-test', isAnonymous: true }),
    watchActivePair: (_uid, onValue) => {
      onValue({ pairId: 'nudge-pair', partnerUid: 'partner' });
      return () => {};
    },
    watchPartnerNudgeState: (_uid, _pair, onValue) => {
      emit = onValue;
      return () => {};
    },
    ...overrides,
  };
  await render(
    <CyclePairProvider
      backend={backend}
      storage={{
        read: async () => null,
        write: async () => {},
        clear: async () => {},
      }}
    >
      <Probe />
    </CyclePairProvider>,
  );
}
it('announces a received nudge from another tab once and opens the partner tab', async () => {
  await start();
  await act(async () => emit({ received, nextAllowedAt: {} }));
  expect(current.toastNotice).toMatchObject({
    kind: 'partner-nudge',
    destination: 'partner',
  });
  expect(current.inAppNotices).toHaveLength(1);
  await act(async () =>
    emit({
      received,
      nextAllowedAt: { 'check-in-request': '2026-11-02T01:00:00.000Z' },
    }),
  );
  expect(current.inAppNotices).toHaveLength(1);
  await act(async () => current.openInAppNotice(current.inAppNotices[0].id));
  expect(current.state.activeTab).toBe('partner');
  expect(current.toastNotice).toBeNull();
});
it('removes the acknowledged notice while preserving a newer nudge received during acknowledgement', async () => {
  let finish!: (value: boolean) => void;
  const acknowledgement = new Promise<boolean>(resolve => {
    finish = resolve;
  });
  await start({ acknowledgePartnerNudge: () => acknowledgement });
  await act(async () => emit({ received, nextAllowedAt: {} }));
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = current.acknowledgePartnerNudge();
  });
  const newer = { ...received, requestId: 'nudge-two' };
  await act(async () => emit({ received: newer, nextAllowedAt: {} }));
  await act(async () => {
    finish(true);
    await pending;
  });
  expect(current.partnerNudgeState.received).toEqual(newer);
  expect(current.inAppNotices).toHaveLength(1);
  expect(current.toastNotice?.sourceId).toBe('nudge-two');
});
