import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildTemplateWorkbook } from '../src/excel.js';

const out = resolve(process.argv[2] ?? 'templates/Valet-Data-Template.xlsx');
mkdirSync(dirname(out), { recursive: true });
await buildTemplateWorkbook().xlsx.writeFile(out);
console.log(`Template written to ${out}`);
