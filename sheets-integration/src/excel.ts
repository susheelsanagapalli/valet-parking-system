import ExcelJS from 'exceljs';
import { parseRecord, toValues, validateRow, type Row } from './rows.js';
import { SCHEMA_VERSION, TABS, type TabDef } from './schema.js';

const FONT = 'Arial';
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
const INPUT_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const BLUE = 'FF0000FF';
const VALIDATED_ROWS = 500;
export const EXAMPLE_ID_PREFIX = 'example-';

const BOOK_LABEL: Record<TabDef['book'], string> = {
  config: 'Config',
  transactions: 'Transactions <yyyy-mm>',
  guest: 'Guest data <yyyy-mm>',
  audit: 'Audit log <yyyy-mm>',
};

function allowedValues(tab: TabDef, key: string): readonly string[] | undefined {
  const col = tab.columns.find((c) => c.key === key);
  if (!col) return undefined;
  return col.enum ?? (col.type === 'boolean' ? ['TRUE', 'FALSE'] : undefined);
}

function addDataTab(wb: ExcelJS.Workbook, tab: TabDef): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(tab.name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = tab.columns.map((c) => ({
    header: c.key,
    key: c.key,
    width: Math.min(40, Math.max(12, c.key.length + 4)),
    style: { font: { name: FONT, size: 10 } },
  }));
  const header = ws.getRow(1);
  header.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  tab.columns.forEach((c, i) => {
    const parts = [c.description, `Type: ${c.type}`, c.required ? 'Required' : 'Optional'];
    if (c.enum) parts.push(`Allowed: ${c.enum.join(', ')}`);
    header.getCell(i + 1).note = parts.join('\n');
  });
  return ws;
}

function addDropdowns(ws: ExcelJS.Worksheet, tab: TabDef, lastRow: number): void {
  tab.columns.forEach((c, i) => {
    const values = allowedValues(tab, c.key);
    if (!values) return;
    for (let r = 2; r <= lastRow; r++) {
      ws.getCell(r, i + 1).dataValidation = {
        type: 'list',
        allowBlank: !c.required,
        formulae: [`"${values.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Invalid value',
        error: `Choose one of: ${values.join(', ')}`,
      };
    }
  });
}

function addReadme(wb: ExcelJS.Workbook, title: string, lines: string[]): void {
  const ws = wb.addWorksheet('Read me');
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 60;
  ws.getColumn(3).width = 26;
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { name: FONT, size: 14, bold: true };
  let r = 3;
  for (const line of lines) {
    ws.getCell(r, 1).value = line;
    ws.getCell(r, 1).font = { name: FONT, size: 10 };
    r++;
  }
  r++;
  ws.getRow(r).values = ['Tab', 'What it holds', 'Google Sheets book'];
  ws.getRow(r).font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(r).fill = HEADER_FILL;
  for (const t of TABS) {
    r++;
    ws.getRow(r).values = [t.name, t.description, BOOK_LABEL[t.book]];
    ws.getRow(r).font = { name: FONT, size: 10 };
    ws.getRow(r).alignment = { wrapText: true, vertical: 'top' };
  }
}

function addColumnDictionary(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet('Columns', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Tab', key: 'tab', width: 22 },
    { header: 'Column', key: 'column', width: 22 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Required', key: 'required', width: 10 },
    { header: 'Allowed values', key: 'allowed', width: 40 },
    { header: 'Description', key: 'description', width: 70 },
  ];
  for (const t of TABS) {
    for (const c of t.columns) {
      ws.addRow({ tab: t.name, column: c.key, type: c.type, required: c.required ? 'Yes' : 'No', allowed: c.enum?.join(', ') ?? '', description: c.description });
    }
  }
  ws.eachRow((row, n) => {
    row.font = n === 1 ? { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } } : { name: FONT, size: 10 };
    if (n === 1) row.fill = HEADER_FILL;
  });
}

/**
 * Blank data template: one tab per spreadsheet tab with headers, dropdowns, column notes and one
 * example row (blue text, id starting "example-") that import skips.
 */
export function buildTemplateWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Valet Parking System';
  wb.created = new Date(Date.UTC(2026, 9, 17));
  addReadme(wb, 'Valet Parking System – data template', [
    `Schema version ${SCHEMA_VERSION}. Each tab matches a Google Sheets tab of the same name (SRS section 6.4).`,
    'Row 1 holds the column keys. Do not rename, reorder or delete header cells.',
    'Row 2 of each tab is an example in blue text. Overwrite it or leave it; rows whose id starts with "example-" are skipped on import.',
    'Enter your data from row 3 in the yellow cells. Columns with a fixed list of values have a dropdown.',
    'Hover over a header cell to see what the column holds, its type and whether it is required.',
    'Dates and times use ISO 8601 in UTC, e.g. 2026-10-17T12:30:00.000Z. Dates use YYYY-MM-DD.',
    'JSON columns (settings, custom_fields, before, after) hold JSON text, e.g. {"reservation_name":"Rao"}.',
    'Handover PINs are never stored; handover_pin_hash is filled in by the system.',
    'Import with: npm run import:excel -- <file.xlsx>',
  ]);
  addColumnDictionary(wb);
  for (const t of TABS) {
    const ws = addDataTab(wb, t);
    const example = ws.addRow(t.columns.map((c) => c.example ?? ''));
    example.font = { name: FONT, size: 10, color: { argb: BLUE } };
    ws.getCell('A2').note = 'Example row – overwrite or leave it; ids starting with "example-" are skipped on import.';
    for (let r = 3; r <= 22; r++) {
      for (let c = 1; c <= t.columns.length; c++) ws.getCell(r, c).fill = INPUT_FILL;
    }
    addDropdowns(ws, t, VALIDATED_ROWS);
  }
  return wb;
}

/** Workbook with real data, e.g. an export of the Google Sheets data for Excel users or backups. */
export function buildExportWorkbook(rowsByTab: Record<string, Row[]>, exportedAt: Date = new Date()): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Valet Parking System';
  wb.created = exportedAt;
  addReadme(wb, 'Valet Parking System – data export', [
    `Exported ${exportedAt.toISOString()} (UTC). Schema version ${SCHEMA_VERSION}.`,
    'This file contains guest personal data. Store it securely and delete it when no longer needed (SRS NFR-PRIV-02).',
  ]);
  for (const t of TABS) {
    const ws = addDataTab(wb, t);
    const rows = rowsByTab[t.name] ?? [];
    for (const r of rows) ws.addRow(toValues(t, r));
    addDropdowns(ws, t, Math.max(2, rows.length + 1));
  }
  return wb;
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;
  if ('richText' in value) return value.richText.map((t) => t.text).join('');
  if ('result' in value) return value.result ?? '';
  if ('text' in value) return value.text;
  return String(value);
}

export interface ImportResult {
  rowsByTab: Record<string, Row[]>;
  errors: string[];
}

/** Reads a template or export workbook; returns typed rows and every problem found. */
export async function readWorkbook(data: ArrayBuffer | Uint8Array | string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  if (typeof data === 'string') await wb.xlsx.readFile(data);
  else await wb.xlsx.load(data instanceof Uint8Array ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer) : data);

  const rowsByTab: Record<string, Row[]> = {};
  const errors: string[] = [];
  for (const t of TABS) {
    const ws = wb.getWorksheet(t.name);
    rowsByTab[t.name] = [];
    if (!ws) continue;
    const header = t.columns.map((_, i) => String(cellValue(ws.getRow(1).getCell(i + 1).value)));
    const mismatch = t.columns.findIndex((c, i) => header[i] !== c.key);
    if (mismatch !== -1) {
      errors.push(`${t.name}: column ${mismatch + 1} should be "${t.columns[mismatch]?.key}" but is "${header[mismatch]}"`);
      continue;
    }
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const record: Record<string, unknown> = {};
      let empty = true;
      t.columns.forEach((c, i) => {
        const v = cellValue(row.getCell(i + 1).value);
        if (v !== '') empty = false;
        record[c.key] = v;
      });
      if (empty || String(record.id ?? '').startsWith(EXAMPLE_ID_PREFIX)) return;
      const parsed = parseRecord(t, record);
      const problems = validateRow(t, parsed);
      if (problems.length > 0) errors.push(`${t.name} row ${n}: ${problems.join('; ')}`);
      else rowsByTab[t.name]?.push(parsed);
    });
  }
  return { rowsByTab, errors };
}
