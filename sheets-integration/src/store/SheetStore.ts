import type { Row } from '../rows.js';
import type { TabDef } from '../schema.js';

/**
 * Low-level tab storage. The repository keeps every row in memory and uses the store only to load
 * at start-up and to persist changes, so the same business logic runs on Google Sheets, in tests
 * (MemorySheetStore) and later on a relational database (NFR-SCAL-03).
 */
export interface SheetStore {
  /** Creates the tab with its header row if missing, and checks an existing header matches the schema. */
  ensureTab(tab: TabDef): Promise<void>;
  readRows(tab: TabDef): Promise<Row[]>;
  appendRows(tab: TabDef, rows: Row[]): Promise<void>;
  /** Overwrites whole rows, matched by their id column. */
  updateRows(tab: TabDef, rows: Row[]): Promise<void>;
}
