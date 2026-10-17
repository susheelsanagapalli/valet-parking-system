import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { SmsSettingsMemory, type SmsSettings } from './smsOptions.js';

export * from './smsOptions.js';

/** SMS settings kept in a server-side file (not in the spreadsheets, which staff can read). */
export class SmsSettingsStore extends SmsSettingsMemory {
  constructor(path?: string) {
    const initial = path && existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SmsSettings) : null;
    super(
      initial,
      path
        ? (s) => {
            writeFileSync(`${path}.tmp`, JSON.stringify(s, null, 2));
            renameSync(`${path}.tmp`, path);
          }
        : undefined,
    );
  }
}
