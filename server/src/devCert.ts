import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';

/**
 * HTTPS for testing on phones over the local network. Phones only give GPS and the live camera to
 * secure (https) pages, so the server also listens on an https port with a self-signed certificate
 * that names this computer's network addresses. Install the certificate on the phone once
 * (/dev-cert.crt) to trust it. Production should use a real certificate instead.
 */
export interface DevCert {
  cert: string;
  key: string;
  /** Certificate in DER form, for installing on phones. */
  der: Buffer;
  hosts: string[];
}

export function localAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => Boolean(i) && i!.family === 'IPv4' && !i!.internal)
    .map((i) => i.address);
}

function toDer(pem: string): Buffer {
  return Buffer.from(pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''), 'base64');
}

/** Loads the certificate from `dir`, creating a new one when this computer's addresses have changed. */
export async function loadOrCreateDevCert(dir: string): Promise<DevCert> {
  const hosts = ['localhost', '127.0.0.1', ...localAddresses()].sort();
  const certFile = join(dir, 'dev-cert.pem');
  const keyFile = join(dir, 'dev-key.pem');
  const hostsFile = join(dir, 'dev-hosts.json');
  if (existsSync(certFile) && existsSync(keyFile) && existsSync(hostsFile)) {
    const saved = JSON.parse(readFileSync(hostsFile, 'utf8')) as string[];
    if (hosts.every((h) => saved.includes(h))) {
      const cert = readFileSync(certFile, 'utf8');
      return { cert, key: readFileSync(keyFile, 'utf8'), der: toDer(cert), hosts: saved };
    }
  }
  const pems = await generate([{ name: 'commonName', value: 'Valet Parking test server' }], {
    notAfterDate: new Date(Date.now() + 365 * 24 * 60 * 60_000),
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: hosts.map((h) => (/^\d+\.\d+\.\d+\.\d+$/.test(h) ? { type: 7, ip: h } : { type: 2, value: h })),
      },
    ],
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(certFile, pems.cert);
  writeFileSync(keyFile, pems.private);
  writeFileSync(hostsFile, JSON.stringify(hosts));
  return { cert: pems.cert, key: pems.private, der: toDer(pems.cert), hosts };
}
