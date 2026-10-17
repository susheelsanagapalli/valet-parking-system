import { resolve } from 'node:path';
import { readWorkbook } from '../src/excel.js';
import { booksFromEnv, createGoogleAuth, sheetsClient } from '../src/google.js';
import { GoogleSheetStore } from '../src/store/GoogleSheetStore.js';
import { ValetSheetsRepository } from '../src/ValetSheetsRepository.js';

// Usage: npm run import:excel -- <file.xlsx> [--dry-run]
const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run import:excel -- <file.xlsx> [--dry-run]');
  process.exit(1);
}
const { rowsByTab, errors } = await readWorkbook(resolve(file));
if (errors.length > 0) {
  console.error(`Found ${errors.length} problem(s); nothing was imported:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
const counts = Object.fromEntries(Object.entries(rowsByTab).map(([tab, rows]) => [tab, rows.length]));
if (process.argv.includes('--dry-run')) {
  console.log('Dry run, rows found per tab:', counts);
  process.exit(0);
}

const store = new GoogleSheetStore({ sheets: sheetsClient(createGoogleAuth()), books: booksFromEnv() });
const repo = new ValetSheetsRepository({ store, pinSecret: process.env.PIN_HMAC_SECRET ?? '', flushIntervalMs: 0 });
await repo.load();
const added = repo.importRows(rowsByTab, 'excel-import');
await repo.close();
console.log('Rows added per tab (existing ids skipped):', added);
