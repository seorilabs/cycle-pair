import {SerializedWriteQueue} from './SerializedWriteQueue';

describe('SerializedWriteQueue', () => {
  it('drains writes admitted before quiesce while rejecting later admission', async () => {
    const queue = new SerializedWriteQueue();
    let quiesced = false;
    let releaseFirst: (() => void) | undefined;
    const order: string[] = [];
    const admit = () => {
      if (quiesced) throw new Error('session quiesced');
    };

    const first = queue.run(
      admit,
      () =>
        new Promise<void>(resolve => {
          releaseFirst = () => {
            order.push('first');
            resolve();
          };
        }),
    );
    const second = queue.run(admit, async () => {
      order.push('second');
    });
    quiesced = true;

    expect(() => queue.run(admit, async () => undefined)).toThrow(
      'session quiesced',
    );
    let drained = false;
    const drain = queue.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    releaseFirst?.();
    await Promise.all([first, second, drain]);
    expect(order).toEqual(['first', 'second']);
    expect(drained).toBe(true);
  });
});
