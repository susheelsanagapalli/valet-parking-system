import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Row } from './rows.js';
import { tab as tabByName, type TabDef } from './schema.js';
import type { SheetStore } from './store/SheetStore.js';

export interface WriteOp {
  kind: 'append' | 'update';
  tab: TabDef;
  rows: Row[];
}

export interface WriteQueueOptions {
  store: SheetStore;
  /** Delay before batched writes are sent; 0 disables the timer (call flush yourself). */
  flushIntervalMs?: number;
  /** Retry delay after a failed flush. */
  retryDelayMs?: number;
  /** File that keeps unsent writes across restarts (SRS NFR-AVL-03). */
  persistPath?: string;
  onError?: (err: unknown) => void;
}

/**
 * Batches writes so the backend stays within Google Sheets API limits. Consecutive writes of the
 * same kind to the same tab are sent in one call, in order. Unsent writes survive a restart when
 * persistPath is set.
 */
export class WriteQueue {
  private ops: WriteOp[] = [];
  private timer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> | undefined;

  constructor(private readonly options: WriteQueueOptions) {
    if (options.persistPath && existsSync(options.persistPath)) {
      const saved = JSON.parse(readFileSync(options.persistPath, 'utf8')) as Array<{ kind: WriteOp['kind']; tab: string; rows: Row[] }>;
      this.ops = saved.map((o) => ({ kind: o.kind, tab: tabByName(o.tab), rows: o.rows }));
    }
  }

  get pending(): number {
    return this.ops.reduce((n, o) => n + o.rows.length, 0);
  }

  enqueue(op: WriteOp): void {
    this.ops.push({ ...op, rows: op.rows.map((r) => structuredClone(r)) });
    this.persist();
    this.schedule(this.options.flushIntervalMs ?? 2000);
  }

  async flush(): Promise<void> {
    while (this.flushing) await this.flushing;
    if (this.ops.length === 0) return;
    this.flushing = this.send();
    try {
      await this.flushing;
    } finally {
      this.flushing = undefined;
    }
  }

  /** Stops the timer and sends everything still queued. */
  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.flush();
  }

  private schedule(delay: number): void {
    if (this.timer || delay <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush().catch((err) => {
        this.options.onError?.(err);
        this.schedule(this.options.retryDelayMs ?? 5000);
      });
    }, delay);
    this.timer.unref?.();
  }

  private async send(): Promise<void> {
    while (this.ops.length > 0) {
      const first = this.ops[0] as WriteOp;
      let count = 1;
      while (count < this.ops.length && this.ops[count]?.kind === first.kind && this.ops[count]?.tab.name === first.tab.name) count++;
      const batch = this.ops.slice(0, count).flatMap((o) => o.rows);
      if (first.kind === 'append') {
        await this.options.store.appendRows(first.tab, batch);
      } else {
        const latest = new Map<unknown, Row>();
        for (const r of batch) latest.set(r.id, r);
        await this.options.store.updateRows(first.tab, [...latest.values()]);
      }
      this.ops.splice(0, count);
      this.persist();
    }
  }

  private persist(): void {
    const path = this.options.persistPath;
    if (!path) return;
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.ops.map((o) => ({ kind: o.kind, tab: o.tab.name, rows: o.rows }))));
    renameSync(tmp, path);
  }
}
