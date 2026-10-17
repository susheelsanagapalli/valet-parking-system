import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { ManualSmsSender, SmsGateSender, normalizeMobile, type SmsSender } from './sms.js';

/** Official download for SMS Gateway for Android (not on Google Play): the latest APK from GitHub releases. */
export const ANDROID_GATEWAY_DOWNLOAD = 'https://github.com/capcom6/android-sms-gateway/releases/latest/download/app-release.apk';
export const ANDROID_GATEWAY_RELEASES = 'https://github.com/capcom6/android-sms-gateway/releases/latest';
export const ANDROID_GATEWAY_DOCS = 'https://docs.sms-gate.app/installation/';
export const SMSGATE_CLOUD_URL = 'https://api.sms-gate.app/3rdparty/v1/message';

/**
 * Guest SMS settings chosen in the admin panel (SRS FR-NOT-05):
 * - iphone: tap-to-send from the Messages app (iOS does not let apps send SMS for a server).
 * - android: automatic sending through the SMS Gateway for Android app on the phone with the SIM.
 */
export interface SmsSettings {
  phoneType: 'iphone' | 'android';
  senderNumber: string;
  android?: { url: string; username: string; password: string };
}

/** What the admin panel sees: the gateway password is never sent back. */
export type PublicSmsSettings = Omit<SmsSettings, 'android'> & { android?: { url: string; username: string; hasPassword: boolean } };

export function toPublic(s: SmsSettings): PublicSmsSettings {
  const { android, ...rest } = s;
  return android ? { ...rest, android: { url: android.url, username: android.username, hasPassword: android.password.length > 0 } } : rest;
}

export function senderFor(s: SmsSettings): SmsSender {
  if (s.phoneType === 'iphone') return new ManualSmsSender();
  if (!s.android?.username || !s.android.password) throw new Error('The Android gateway username and password are required');
  return new SmsGateSender({ url: s.android.url || SMSGATE_CLOUD_URL, username: s.android.username, password: s.android.password });
}

/** Keeps the settings in a server-side file (not in the operator's spreadsheets, which staff can read). */
export class SmsSettingsStore {
  private current: SmsSettings | null = null;

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) this.current = JSON.parse(readFileSync(path, 'utf8')) as SmsSettings;
  }

  get(): SmsSettings | null {
    return this.current ? structuredClone(this.current) : null;
  }

  /** Validates and saves; an empty Android password keeps the saved one. */
  save(input: SmsSettings): SmsSettings {
    const senderNumber = normalizeMobile(input.senderNumber);
    if (!senderNumber) throw new Error('Enter a valid mobile number, e.g. 9515858993');
    let android: SmsSettings['android'];
    if (input.phoneType === 'android') {
      const previous = this.current?.android;
      android = {
        url: input.android?.url?.trim() || SMSGATE_CLOUD_URL,
        username: input.android?.username?.trim() ?? '',
        password: input.android?.password || previous?.password || '',
      };
      if (!/^https?:\/\/.+/.test(android.url)) throw new Error('The gateway address must start with http:// or https://');
    }
    const next: SmsSettings = { phoneType: input.phoneType, senderNumber, ...(android ? { android } : {}) };
    senderFor(next);
    this.current = next;
    if (this.path) {
      writeFileSync(`${this.path}.tmp`, JSON.stringify(next, null, 2));
      renameSync(`${this.path}.tmp`, this.path);
    }
    return structuredClone(next);
  }
}
