/**
 * Serializes writes after a synchronous admission decision.
 *
 * A write admitted before account quiescing remains part of the drain set and
 * executes exactly once. New writes still fail at admission after quiescing.
 */
export class SerializedWriteQueue {
  private chain: Promise<void> = Promise.resolve();

  run<T>(admit: () => void, write: () => Promise<T>): Promise<T> {
    admit();
    const result = this.chain.then(write, write);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  drain(): Promise<void> {
    return this.chain;
  }
}
