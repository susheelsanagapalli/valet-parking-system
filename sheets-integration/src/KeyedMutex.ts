/**
 * Serialises work per key inside one backend process. Google Sheets has no row locks, so this is
 * what guarantees one task per attendant (FR-TASK-02), unique slots (FR-PARK-04) and sequential
 * ticket numbers. Running several backend instances needs a shared lock service instead.
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
