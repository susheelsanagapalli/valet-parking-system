import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { drive_v3 } from 'googleapis';
import type { PhotoStorage as PhotoStorageKind } from '@valet/sheets-integration';

export interface StoredFile {
  data: Buffer;
  mime: string;
}

/** Photo storage integration, separate from the Sheets records (FR-DATA-07). */
export interface PhotoStore {
  readonly kind: PhotoStorageKind;
  save(data: Buffer, mime: string): Promise<string>;
  read(ref: string): Promise<StoredFile>;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

export class LocalPhotoStore implements PhotoStore {
  readonly kind = 'object_storage' as const;
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async save(data: Buffer, mime: string): Promise<string> {
    const name = `${randomUUID()}.${EXT[mime] ?? 'bin'}`;
    writeFileSync(join(this.dir, name), data);
    return `local:${name}`;
  }

  async read(ref: string): Promise<StoredFile> {
    const name = ref.replace(/^local:/, '');
    if (!/^[\w-]+\.(jpg|png)$/.test(name)) throw new Error('Invalid file reference');
    return { data: readFileSync(join(this.dir, name)), mime: name.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  }
}

export class DrivePhotoStore implements PhotoStore {
  readonly kind = 'google_drive' as const;
  constructor(
    private readonly drive: drive_v3.Drive,
    private readonly folderId?: string,
  ) {}

  async save(data: Buffer, mime: string): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: { name: `${randomUUID()}.${EXT[mime] ?? 'bin'}`, parents: this.folderId ? [this.folderId] : undefined },
      media: { mimeType: mime, body: Readable.from(data) },
      fields: 'id',
      supportsAllDrives: true,
    });
    if (!res.data.id) throw new Error('Drive upload failed');
    return `drive:${res.data.id}`;
  }

  async read(ref: string): Promise<StoredFile> {
    const fileId = ref.replace(/^drive:/, '');
    const meta = await this.drive.files.get({ fileId, fields: 'mimeType', supportsAllDrives: true });
    const res = await this.drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    return { data: Buffer.from(res.data as ArrayBuffer), mime: meta.data.mimeType ?? 'image/jpeg' };
  }
}

/** Short-lived signed links so photos can be shown in <img> tags without exposing them publicly. */
export function signFileUrl(secret: string, ref: string, ttlMs = 10 * 60_000, now = Date.now()): string {
  const exp = now + ttlMs;
  const sig = createHmac('sha256', secret).update(`${ref}|${exp}`).digest('base64url');
  return `/api/files?ref=${encodeURIComponent(ref)}&exp=${exp}&sig=${sig}`;
}

export function checkFileSignature(secret: string, ref: string, exp: number, sig: string, now = Date.now()): boolean {
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = createHmac('sha256', secret).update(`${ref}|${exp}`).digest('base64url');
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

const MAX_BYTES = 400_000;

/** Decodes a data URL from the client; photos are resized to 300 KB or less before upload. */
export function decodeImage(dataUrl: string): StoredFile {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match?.[1] || !match[2]) throw new Error('Expected a JPEG or PNG data URL');
  const data = Buffer.from(match[2], 'base64');
  if (data.length > MAX_BYTES) throw new Error('Image is larger than 400 KB');
  return { data, mime: match[1] };
}
