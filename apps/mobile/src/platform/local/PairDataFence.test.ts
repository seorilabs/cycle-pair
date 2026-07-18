/* eslint-env jest */

import { PairDataFence } from './PairDataFence';

describe('PairDataFence', () => {
  it('drains an in-flight writer and rejects queued or future revoked-Pair writes', async () => {
    const fence = new PairDataFence();
    let releaseWrite: (() => void) | undefined;
    const writing = fence.runWrite(
      'uid-a',
      'pair-a',
      () =>
        new Promise<void>(resolve => {
          releaseWrite = resolve;
        }),
    );

    const draining = fence.blockAndDrain('uid-a', 'pair-a');
    await expect(
      fence.runWrite('uid-a', 'pair-a', async () => undefined),
    ).rejects.toThrow('Pair data is revoked.');

    let drained = false;
    draining.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    releaseWrite?.();
    await expect(writing).resolves.toBeUndefined();
    await expect(draining).resolves.toBeUndefined();
    expect(drained).toBe(true);
  });
});
