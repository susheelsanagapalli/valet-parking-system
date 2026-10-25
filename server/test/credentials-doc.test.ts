import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROLE_LABELS } from '../src/permissions.js';
import { DEMO_PASSWORD, DEMO_USERS } from '../src/seedData.js';

// docs/TEST-CREDENTIALS.md is the one place people look up test logins; keep it in step with the code.
const doc = readFileSync(join(import.meta.dirname, '../../docs/TEST-CREDENTIALS.md'), 'utf8');

describe('docs/TEST-CREDENTIALS.md', () => {
  it('lists the demo password', () => {
    expect(doc).toContain(`\`${DEMO_PASSWORD}\``);
  });

  it('lists every demo account with its name and role', () => {
    for (const u of DEMO_USERS) {
      const row = doc.split('\n').find((line) => line.startsWith(`| \`${u.username}\` |`));
      expect(row, `row for ${u.username}`).toBeDefined();
      expect(row).toContain(u.name);
      expect(row).toContain(ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]);
    }
  });

  it('contains no real secrets', () => {
    // Only the public demo password; no scrypt hashes, deploy hooks or tokens.
    expect(doc).not.toMatch(/scrypt\$/);
    expect(doc).not.toMatch(/api\.render\.com\/deploy|srv-[a-z0-9]+\?key=/);
    expect(doc).not.toMatch(/nfp_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}/);
  });
});
