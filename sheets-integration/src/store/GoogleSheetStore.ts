import type { sheets_v4 } from 'googleapis';
import { ValetError } from '../errors.js';
import { parseRecord, toValues, type Row } from '../rows.js';
import type { BookKind, TabDef } from '../schema.js';
import type { SheetStore } from './SheetStore.js';

export interface GoogleSheetStoreOptions {
  sheets: sheets_v4.Sheets;
  /** Spreadsheet id for each book (SRS 6.4). */
  books: Record<BookKind, string>;
  maxRetries?: number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function columnLetter(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function quote(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function statusOf(err: unknown): number | undefined {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const value = e.response?.status ?? e.status ?? e.code;
  return typeof value === 'number' ? value : undefined;
}

/** Stores each tab in a Google Sheets tab; row 1 is the header of column keys. */
export class GoogleSheetStore implements SheetStore {
  private readonly sheets: sheets_v4.Sheets;
  private readonly maxRetries: number;
  /** tab name → (row id → sheet row number) */
  private readonly rowNumbers = new Map<string, Map<string, number>>();

  constructor(private readonly options: GoogleSheetStoreOptions) {
    this.sheets = options.sheets;
    this.maxRetries = options.maxRetries ?? 5;
  }

  private spreadsheetId(tab: TabDef): string {
    const id = this.options.books[tab.book];
    if (!id) throw new Error(`No spreadsheet id configured for the ${tab.book} book`);
    return id;
  }

  /** Retries rate-limit and server errors with exponential backoff (Sheets API usage limits). */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const status = statusOf(err);
        if (attempt >= this.maxRetries || status === undefined || !RETRYABLE.has(status)) throw err;
        const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async ensureTab(tab: TabDef): Promise<void> {
    const spreadsheetId = this.spreadsheetId(tab);
    const meta = await this.call(() =>
      this.sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' }),
    );
    let sheetId = meta.data.sheets?.find((s) => s.properties?.title === tab.name)?.properties?.sheetId ?? undefined;
    const created = sheetId === undefined;

    if (created) {
      const res = await this.call(() =>
        this.sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: tab.name, gridProperties: { frozenRowCount: 1 } } } }] },
        }),
      );
      sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;
      if (sheetId === undefined) throw new Error(`Could not create tab ${tab.name}`);
    }

    const wanted = tab.columns.map((c) => c.key);
    const headerRes = await this.call(() => this.sheets.spreadsheets.values.get({ spreadsheetId, range: `${quote(tab.name)}!1:1` }));
    const current = (headerRes.data.values?.[0] ?? []).map(String);
    for (let i = 0; i < current.length; i++) {
      if (current[i] !== wanted[i]) {
        throw new ValetError('SCHEMA_MISMATCH', `Tab ${tab.name} column ${columnLetter(i + 1)} is "${current[i]}", expected "${wanted[i] ?? '(none)'}"`);
      }
    }
    if (current.length < wanted.length) {
      const start = columnLetter(current.length + 1);
      await this.call(() =>
        this.sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${quote(tab.name)}!${start}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [wanted.slice(current.length)] },
        }),
      );
    }

    if (created) await this.formatNewTab(spreadsheetId, sheetId as number, tab);
  }

  /** Header style, dropdowns for enum and boolean columns, and a warning-only protection (FR-DATA-02). */
  private async formatNewTab(spreadsheetId: string, sheetId: number, tab: TabDef): Promise<void> {
    const requests: sheets_v4.Schema$Request[] = [
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.92, blue: 0.95 } } },
          fields: 'userEnteredFormat(textFormat,backgroundColor)',
        },
      },
      {
        addProtectedRange: {
          protectedRange: { range: { sheetId }, description: 'Managed by the valet system. Edit through the admin panel.', warningOnly: true },
        },
      },
    ];
    tab.columns.forEach((c, i) => {
      const values = c.enum ?? (c.type === 'boolean' ? ['TRUE', 'FALSE'] : undefined);
      if (!values) return;
      requests.push({
        setDataValidation: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
          rule: { condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true },
        },
      });
    });
    await this.call(() => this.sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }));
  }

  async readRows(tab: TabDef): Promise<Row[]> {
    const spreadsheetId = this.spreadsheetId(tab);
    const res = await this.call(() =>
      this.sheets.spreadsheets.values.get({ spreadsheetId, range: quote(tab.name), valueRenderOption: 'UNFORMATTED_VALUE' }),
    );
    const [header = [], ...data] = res.data.values ?? [];
    const keys = header.map(String);
    const index = new Map<string, number>();
    const rows: Row[] = [];
    data.forEach((cells, i) => {
      if (!cells.some((c) => c !== '' && c !== null && c !== undefined)) return;
      const record: Record<string, unknown> = {};
      keys.forEach((k, j) => (record[k] = cells[j]));
      const row = parseRecord(tab, record);
      rows.push(row);
      index.set(String(row.id), i + 2);
    });
    this.rowNumbers.set(tab.name, index);
    return rows;
  }

  async appendRows(tab: TabDef, rows: Row[]): Promise<void> {
    if (rows.length === 0) return;
    const spreadsheetId = this.spreadsheetId(tab);
    const res = await this.call(() =>
      this.sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${quote(tab.name)}!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows.map((r) => toValues(tab, r)) },
      }),
    );
    const match = /!\$?[A-Z]+\$?(\d+)/.exec(res.data.updates?.updatedRange ?? '');
    const index = this.rowNumbers.get(tab.name);
    if (match?.[1] && index) {
      const first = Number(match[1]);
      rows.forEach((r, i) => index.set(String(r.id), first + i));
    } else {
      this.rowNumbers.delete(tab.name);
    }
  }

  async updateRows(tab: TabDef, rows: Row[]): Promise<void> {
    if (rows.length === 0) return;
    const spreadsheetId = this.spreadsheetId(tab);
    let index = this.rowNumbers.get(tab.name);
    if (!index || rows.some((r) => !index?.has(String(r.id)))) {
      await this.readRows(tab);
      index = this.rowNumbers.get(tab.name);
    }
    const lastColumn = columnLetter(tab.columns.length);
    const data = rows.map((r) => {
      const rowNumber = index?.get(String(r.id));
      if (rowNumber === undefined) throw new Error(`Row ${String(r.id)} not found in ${tab.name}`);
      return { range: `${quote(tab.name)}!A${rowNumber}:${lastColumn}${rowNumber}`, values: [toValues(tab, r)] };
    });
    await this.call(() =>
      this.sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } }),
    );
  }
}
