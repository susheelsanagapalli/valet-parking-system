import { cloneRow, type Row } from '../rows.js';
import type { TabDef } from '../schema.js';
import type { SheetStore } from './SheetStore.js';

/** In-memory store for tests and local demos. */
export class MemorySheetStore implements SheetStore {
  readonly tabs = new Map<string, Row[]>();
  private failuresLeft = 0;

  /** Makes the next `count` write calls throw, to exercise retries. */
  failNextWrites(count: number): void {
    this.failuresLeft = count;
  }

  async ensureTab(tab: TabDef): Promise<void> {
    if (!this.tabs.has(tab.name)) this.tabs.set(tab.name, []);
  }

  async readRows(tab: TabDef): Promise<Row[]> {
    return (this.tabs.get(tab.name) ?? []).map(cloneRow);
  }

  async appendRows(tab: TabDef, rows: Row[]): Promise<void> {
    this.maybeFail();
    const target = this.tabs.get(tab.name);
    if (!target) throw new Error(`Tab ${tab.name} does not exist`);
    target.push(...rows.map(cloneRow));
  }

  async updateRows(tab: TabDef, rows: Row[]): Promise<void> {
    this.maybeFail();
    const target = this.tabs.get(tab.name);
    if (!target) throw new Error(`Tab ${tab.name} does not exist`);
    for (const row of rows) {
      const index = target.findIndex((r) => r.id === row.id);
      if (index === -1) throw new Error(`Row ${String(row.id)} not found in ${tab.name}`);
      target[index] = cloneRow(row);
    }
  }

  private maybeFail(): void {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error('Simulated storage failure');
    }
  }
}
