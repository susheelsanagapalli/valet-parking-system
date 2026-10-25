/**
 * Creates or updates staff accounts in the STAFF_USERS_FILE used in production.
 *
 *   npm run staff-user -- --file staff-users.json --username asha --name "Asha Rao" --role operator_admin
 *   npm run staff-user -- --file staff-users.json --username ravi --name "Ravi" --role attendant --locations <location id>
 *   npm run staff-user -- --file staff-users.json --remove ravi
 *   npm run staff-user -- --file staff-users.json --list
 *
 * The password is asked for without showing it (or read from STAFF_PASSWORD, for scripts), so it
 * does not end up in the shell history. Only a scrypt hash is written to the file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { ROLES, type StaffUser } from '../permissions.js';
import { MIN_PASSWORD_LENGTH, removeStaffUser, upsertStaffUser } from '../staffUsers.js';

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    out._writeToOutput = (s: string) => {
      if (!prompted) {
        out.output.write(s);
        prompted = true;
      } else if (s.includes('\n')) out.output.write('\n');
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', default: 'staff-users.json' },
      username: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' },
      locations: { type: 'string', default: 'all' },
      remove: { type: 'string' },
      list: { type: 'boolean', default: false },
    },
  });
  const file = values.file!;
  const users: StaffUser[] = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StaffUser[]) : [];

  if (values.list) {
    if (users.length === 0) console.log(`${file} has no users.`);
    for (const u of users) console.log(`${u.username.padEnd(20)} ${u.role.padEnd(18)} ${u.locations === 'all' ? 'all locations' : u.locations.join(', ')}  (${u.name})`);
    return;
  }

  if (values.remove) {
    writeFileSync(file, `${JSON.stringify(removeStaffUser(users, values.remove), null, 2)}\n`);
    console.log(`Removed ${values.remove} from ${file}. Restart the server (or redeploy) to apply.`);
    return;
  }

  if (!values.username || !values.name || !values.role) {
    console.error(`Usage: npm run staff-user -- --file staff-users.json --username <name> --name "<Full name>" --role <${ROLES.join('|')}> [--locations all|<id>,<id>]`);
    process.exitCode = 1;
    return;
  }

  let password = process.env.STAFF_PASSWORD ?? '';
  if (!password) {
    password = await askHidden(`Password for ${values.username} (at least ${MIN_PASSWORD_LENGTH} characters): `);
    const again = await askHidden('Repeat the password: ');
    if (again !== password) throw new Error('The passwords do not match');
  }

  const { users: next, created } = upsertStaffUser(users, { username: values.username, name: values.name, role: values.role, locations: values.locations!, password });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${created ? 'Added' : 'Updated'} ${values.username} (${values.role}) in ${file}. Restart the server (or redeploy) to apply.`);
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
