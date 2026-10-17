import type { ColumnDef, TabDef } from './schema.js';

export type CellValue = string | number | boolean;
export type Row = Record<string, unknown>;

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function serialToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_MS + serial * 86_400_000);
}

/** Converts a typed value to what is written into a sheet cell. Empty values become ''. */
export function toCell(col: ColumnDef, value: unknown): CellValue {
  if (value === undefined || value === null || value === '') return col.type === 'boolean' ? false : '';
  switch (col.type) {
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'boolean':
      return value === true || value === 'TRUE' || value === 'true';
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value);
    case 'datetime':
      return value instanceof Date ? value.toISOString() : String(value);
    case 'date':
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    default:
      return String(value);
  }
}

/** Converts a raw cell (from Google Sheets or Excel) to a typed value. Empty cells become null (false for booleans). */
export function fromCell(col: ColumnDef, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') return col.type === 'boolean' ? false : null;
  switch (col.type) {
    case 'number':
      return typeof raw === 'number' ? raw : Number(String(raw).trim());
    case 'boolean':
      return raw === true || String(raw).toUpperCase() === 'TRUE';
    case 'json':
      if (typeof raw !== 'string') return raw;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    case 'datetime':
      if (raw instanceof Date) return raw.toISOString();
      if (typeof raw === 'number') return serialToDate(raw).toISOString();
      return String(raw);
    case 'date':
      if (raw instanceof Date) return raw.toISOString().slice(0, 10);
      if (typeof raw === 'number') return serialToDate(raw).toISOString().slice(0, 10);
      return String(raw).slice(0, 10);
    default:
      return String(raw);
  }
}

export function toValues(tab: TabDef, row: Row): CellValue[] {
  return tab.columns.map((c) => toCell(c, row[c.key]));
}

/** Builds a typed row from a record keyed by column name; unknown keys are dropped. */
export function parseRecord(tab: TabDef, record: Record<string, unknown>): Row {
  const row: Row = {};
  for (const c of tab.columns) row[c.key] = fromCell(c, record[c.key]);
  return row;
}

/** Returns human-readable problems with a row; empty when it is valid. */
export function validateRow(tab: TabDef, row: Row): string[] {
  const errors: string[] = [];
  for (const c of tab.columns) {
    const v = row[c.key];
    const empty = v === null || v === undefined || v === '';
    if (empty) {
      if (c.required && c.type !== 'boolean') errors.push(`${c.key} is required`);
      continue;
    }
    if (c.type === 'number' && (typeof v !== 'number' || Number.isNaN(v))) errors.push(`${c.key} must be a number`);
    if (c.type === 'datetime' && Number.isNaN(Date.parse(String(v)))) errors.push(`${c.key} must be a date and time`);
    if (c.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors.push(`${c.key} must be a date (YYYY-MM-DD)`);
    if (c.enum && !c.enum.includes(String(v))) errors.push(`${c.key} must be one of: ${c.enum.join(', ')}`);
  }
  return errors;
}

export function cloneRow<T extends Row>(row: T): T {
  return structuredClone(row);
}
