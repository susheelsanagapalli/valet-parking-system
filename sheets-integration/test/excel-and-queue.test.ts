import ExcelJS from 'exceljs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildExportWorkbook, buildTemplateWorkbook, readWorkbook } from '../src/excel.js';
import { feeForMinutes } from '../src/fees.js';
import { columnLetter } from '../src/store/GoogleSheetStore.js';
import { MemorySheetStore } from '../src/store/MemorySheetStore.js';
import { TABS, tab } from '../src/schema.js';
import { WriteQueue } from '../src/WriteQueue.js';
import { FOUR_PHOTOS, setup } from './helpers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('Excel template', () => {
  it('has a tab per sheet with the schema header, dropdowns and an example row', async () => {
    const wb = buildTemplateWorkbook();
    const buffer = await wb.xlsx.writeBuffer();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer as ArrayBuffer);

    expect(loaded.getWorksheet('Read me')).toBeDefined();
    expect(loaded.getWorksheet('Columns')).toBeDefined();
    for (const t of TABS) {
      const ws = loaded.getWorksheet(t.name);
      expect(ws, t.name).toBeDefined();
      const header = t.columns.map((_, i) => ws?.getRow(1).getCell(i + 1).value);
      expect(header).toEqual(t.columns.map((c) => c.key));
      expect(String(ws?.getCell('A2').value)).toMatch(/^example-/);
    }
    const statusCol = tab('Tickets').columns.findIndex((c) => c.key === 'status') + 1;
    const validation = loaded.getWorksheet('Tickets')?.getCell(3, statusCol).dataValidation;
    expect(validation?.type).toBe('list');
    expect(validation?.formulae?.[0]).toContain('retrieval_requested');
  });

  it('skips example rows when importing the blank template', async () => {
    const buffer = await buildTemplateWorkbook().xlsx.writeBuffer();
    const { rowsByTab, errors } = await readWorkbook(buffer as ArrayBuffer);
    expect(errors).toEqual([]);
    expect(Object.values(rowsByTab).every((rows) => rows.length === 0)).toBe(true);
  });

  it('round-trips repository data through an export workbook', async () => {
    const { repo, location } = await setup('paid_parking');
    const { ticket } = await repo.checkIn({ locationId: location.id, attendantId: 'a', plateNumber: 'RT1', keyTag: 'K', guestMobile: '+911234567890', vehiclePhotoRefs: FOUR_PHOTOS });
    await repo.recordParkingSpot(ticket.id, { attendantId: 'a', zoneCode: 'A', slotNumber: '7' });

    const exported = repo.exportRows();
    const buffer = await buildExportWorkbook(exported).xlsx.writeBuffer();
    const { rowsByTab, errors } = await readWorkbook(buffer as ArrayBuffer);
    expect(errors).toEqual([]);
    for (const t of TABS) expect(rowsByTab[t.name], t.name).toEqual(exported[t.name]);

    const target = await setup('custom');
    const added = target.repo.importRows(rowsByTab, 'importer');
    expect(added.Tickets).toBe(1);
    expect(target.repo.getTicketDetails(ticket.id).vehicle?.plate_number).toBe('RT1');
    expect(target.repo.importRows(rowsByTab, 'importer').Tickets).toBe(0);
  });

  it('reports invalid rows instead of importing them', async () => {
    const wb = buildTemplateWorkbook();
    const ws = wb.getWorksheet('Tasks');
    if (!ws) throw new Error('Tasks tab missing');
    ws.getRow(3).getCell(1).value = 'task-1';
    ws.getRow(3).getCell(4).value = 'fly';
    const { rowsByTab, errors } = await readWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(rowsByTab.Tasks).toHaveLength(0);
    expect(errors.join('\n')).toMatch(/Tasks row 3: .*type must be one of/);
  });
});

describe('write queue', () => {
  it('batches writes, retries after a failure and survives a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'valet-queue-'));
    dirs.push(dir);
    const persistPath = join(dir, 'queue.json');
    const store = new MemorySheetStore();
    const incidents = tab('Incidents');
    await store.ensureTab(incidents);

    const queue = new WriteQueue({ store, flushIntervalMs: 0, persistPath });
    const row = (id: string) => ({ id, ticket_id: 't', type: 'delay', description: null, status: 'open', reported_by: 'x', created_at: '2026-10-17T00:00:00.000Z', resolved_at: null });
    queue.enqueue({ kind: 'append', tab: incidents, rows: [row('i1')] });
    queue.enqueue({ kind: 'append', tab: incidents, rows: [row('i2')] });

    store.failNextWrites(1);
    await expect(queue.flush()).rejects.toThrow(/Simulated/);
    expect(queue.pending).toBe(2);

    const restarted = new WriteQueue({ store, flushIntervalMs: 0, persistPath });
    expect(restarted.pending).toBe(2);
    await restarted.flush();
    expect(store.tabs.get('Incidents')?.map((r) => r.id)).toEqual(['i1', 'i2']);
    expect(restarted.pending).toBe(0);
  });
});

describe('helpers', () => {
  it('converts column numbers to letters', () => {
    expect([1, 26, 27, 52, 703].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'AAA']);
  });

  it('applies free minutes and daily caps', () => {
    const tariff = { type: 'hourly' as const, rate: 50, freeMinutes: 10, dailyCap: 400 };
    expect(feeForMinutes(tariff, 10)).toBe(0);
    expect(feeForMinutes(tariff, 71)).toBe(100);
    expect(feeForMinutes(tariff, 24 * 60 + 10 + 30)).toBe(450);
    expect(feeForMinutes({ type: 'complimentary', rate: 0, freeMinutes: 0 }, 500)).toBe(0);
    expect(feeForMinutes({ type: 'flat', rate: 200, freeMinutes: 0 }, 5)).toBe(200);
  });
});
