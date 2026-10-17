import type { sheets_v4 } from 'googleapis';
import { describe, expect, it } from 'vitest';
import { GoogleSheetStore } from '../src/store/GoogleSheetStore.js';
import { tab } from '../src/schema.js';

/** Minimal in-memory imitation of the Sheets v4 calls GoogleSheetStore uses. */
function fakeSheets() {
  const grids = new Map<string, unknown[][]>();
  const titles: string[] = [];
  const requests: sheets_v4.Schema$Request[] = [];
  const nameOf = (range: string) => range.split('!')[0]?.replace(/^'|'$/g, '').replace(/''/g, "'") ?? '';
  const rowOf = (range: string) => Number(/!\$?[A-Z]+(\d+)/.exec(range)?.[1] ?? '1');
  let calls429 = 1;

  const api = {
    spreadsheets: {
      get: async () => ({ data: { sheets: titles.map((title, i) => ({ properties: { title, sheetId: i } })) } }),
      batchUpdate: async ({ requestBody }: { requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest }) => {
        const replies = (requestBody.requests ?? []).map((r) => {
          requests.push(r);
          if (r.addSheet?.properties?.title) {
            titles.push(r.addSheet.properties.title);
            grids.set(r.addSheet.properties.title, []);
            return { addSheet: { properties: { sheetId: titles.length - 1 } } };
          }
          return {};
        });
        return { data: { replies } };
      },
      values: {
        get: async ({ range }: { range: string }) => {
          const grid = grids.get(nameOf(range)) ?? [];
          return { data: { values: range.endsWith('!1:1') ? grid.slice(0, 1) : grid } };
        },
        update: async ({ range, requestBody }: { range: string; requestBody: { values: unknown[][] } }) => {
          const grid = grids.get(nameOf(range)) ?? [];
          grid[0] = [...(grid[0] ?? []), ...(requestBody.values[0] ?? [])];
          return { data: {} };
        },
        append: async ({ range, requestBody }: { range: string; requestBody: { values: unknown[][] } }) => {
          if (calls429-- > 0) throw Object.assign(new Error('rate limited'), { code: 429 });
          const grid = grids.get(nameOf(range)) ?? [];
          const first = grid.length + 1;
          grid.push(...requestBody.values);
          return { data: { updates: { updatedRange: `'${nameOf(range)}'!A${first}:Z${grid.length}` } } };
        },
        batchUpdate: async ({ requestBody }: { requestBody: { data: Array<{ range: string; values: unknown[][] }> } }) => {
          for (const d of requestBody.data) {
            const grid = grids.get(nameOf(d.range)) ?? [];
            grid[rowOf(d.range) - 1] = d.values[0] ?? [];
          }
          return { data: {} };
        },
      },
    },
  };
  return { api: api as unknown as sheets_v4.Sheets, grids, requests };
}

describe('GoogleSheetStore', () => {
  it('creates tabs, appends with retry, updates the right row and reads back typed rows', async () => {
    const { api, grids, requests } = fakeSheets();
    const store = new GoogleSheetStore({ sheets: api, books: { config: 'c', transactions: 't', guest: 'g', audit: 'a' }, maxRetries: 2 });
    const tasks = tab('Tasks');
    await store.ensureTab(tasks);
    expect(grids.get('Tasks')?.[0]).toEqual(tasks.columns.map((c) => c.key));
    expect(requests.some((r) => r.setDataValidation)).toBe(true);
    expect(requests.some((r) => r.addProtectedRange?.protectedRange?.warningOnly)).toBe(true);

    const base = { ticket_id: 't1', location_id: 'l1', type: 'park', assigned_to: null, priority: 0, release_at: '2026-10-17T12:00:00.000Z', created_at: '2026-10-17T12:00:00.000Z', accepted_at: null, completed_at: null };
    await store.appendRows(tasks, [{ id: 'x1', status: 'pending', ...base }, { id: 'x2', status: 'pending', ...base }]);
    await store.updateRows(tasks, [{ id: 'x2', status: 'completed', ...base, priority: 5 }]);

    expect(grids.get('Tasks')?.[2]?.[4]).toBe('completed');
    const rows = await store.readRows(tasks);
    expect(rows.map((r) => [r.id, r.status, r.priority, r.assigned_to])).toEqual([
      ['x1', 'pending', 0, null],
      ['x2', 'completed', 5, null],
    ]);
  });

  it('refuses a tab whose header does not match the schema', async () => {
    const { api, grids } = fakeSheets();
    const store = new GoogleSheetStore({ sheets: api, books: { config: 'c', transactions: 't', guest: 'g', audit: 'a' } });
    const incidents = tab('Incidents');
    await store.ensureTab(incidents);
    grids.get('Incidents')![0] = ['id', 'wrong_column'];
    await expect(store.ensureTab(incidents)).rejects.toThrow(/expected "ticket_id"/);
  });
});
