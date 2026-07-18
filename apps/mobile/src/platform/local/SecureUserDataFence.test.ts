import { SecureUserDataFence } from './SecureUserDataFence';

describe('SecureUserDataFence', () => {
  it('blocks new writes, drains an in-flight write, and only then crosses the purge boundary', async () => {
    const fence = new SecureUserDataFence();
    let finishWrite!: () => void;
    const inFlight = fence.runWrite(
      'user-a',
      () => new Promise<void>(resolve => {
        finishWrite = resolve;
      }),
    );

    let drained = false;
    const drain = fence.blockAndDrain('user-a').then(() => {
      drained = true;
    });
    await expect(
      fence.runWrite('user-a', async () => undefined),
    ).rejects.toThrow('quiesced');
    expect(drained).toBe(false);

    finishWrite();
    await inFlight;
    await drain;
    expect(drained).toBe(true);
    await expect(
      fence.runWrite('user-a', async () => undefined),
    ).rejects.toThrow('quiesced');

    fence.resume('user-a');
    await expect(
      fence.runWrite('user-a', async () => undefined),
    ).resolves.toBeUndefined();
  });
});
