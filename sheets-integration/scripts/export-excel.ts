import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildExportWorkbook } from '../src/excel.js';
import { booksFromEnv, createGoogleAuth, sheetsClient } from '../src/google.js';
import { GoogleSheetStore } from '../src/store/GoogleSheetStore.js';
import { ValetSheetsRepository } from '../src/ValetSheetsRepository.js';

// Usage: npm run export:excel -- [output.xlsx]
const now = new Date();
const out = resolve(process.argv[2] ?? `exports/valet-export-${now.toISOString().slice(0, 10)}.xlsx`);
const store = new GoogleSheetStore({ sheets: sheetsClient(createGoogleAuth()), books: booksFromEnv() });
const repo = new ValetSheetsRepository({ store, pinSecret: process.env.PIN_HMAC_SECRET ?? '', flushIntervalMs: 0 });
await repo.load();

mkdirSync(dirname(out), { recursive: true });
await buildExportWorkbook(repo.exportRows(), now).xlsx.writeFile(out);
console.log(`Exported to ${out}`);
