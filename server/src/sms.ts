import { randomUUID } from 'node:crypto';

/**
 * Guest SMS (SRS FR-NOT-01, FR-NOT-04, FR-NOT-05).
 *
 * To send from the operator's own mobile number without a paid SMS provider, an Android phone with
 * that SIM acts as the gateway, through one of two free apps:
 * - SMS Gateway for Android (sms-gate.app): cloud or local-network API, basic auth.
 * - httpSMS (httpsms.com): cloud API with an API key; the free plan has a monthly limit.
 * "manual" (tap-to-send) works with iPhones: staff send each message from Messages with one tap.
 * "log" prints messages instead of sending them, for development and testing.
 */

export interface SmsSender {
  readonly name: string;
  /** True when staff send each message themselves from their phone's Messages app. */
  readonly manual?: boolean;
  send(to: string, text: string): Promise<void>;
}

/**
 * Tap-to-send: works with any phone, including iPhone, which cannot send SMS for a server. The app
 * shows staff a button that opens Messages with the number and text filled in; the message goes
 * from that phone's own number when they tap Send.
 */
export class ManualSmsSender implements SmsSender {
  readonly name = 'manual';
  readonly manual = true;
  async send(): Promise<void> {
    throw new Error('Manual messages are sent by staff from their phone');
  }
}

/** Converts Indian 10-digit numbers (with or without 0/+91) to +91XXXXXXXXXX; leaves other +E.164 numbers as they are. */
export function normalizeMobile(input: string, defaultCountryCode = '91'): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  const plain = digits.replace(/\D/g, '').replace(/^0+/, '');
  if (plain.length === 10) return `+${defaultCountryCode}${plain}`;
  if (plain.length === 12 && plain.startsWith(defaultCountryCode)) return `+${plain}`;
  return null;
}

async function check(res: Response, provider: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  throw new Error(`${provider} responded ${res.status}: ${body.slice(0, 200)}`);
}

/** SMS switched off until an admin sets it up. */
export class OffSmsSender implements SmsSender {
  readonly name = 'off';
  async send(): Promise<void> {
    throw new Error('SMS is not set up');
  }
}

export class LogSmsSender implements SmsSender {
  readonly name = 'log';
  async send(to: string, text: string): Promise<void> {
    console.log(`[SMS → ${to}] ${text}`);
  }
}

/** SMS Gateway for Android: https://sms-gate.app (cloud) or http://<phone-ip>:8080/message (local network). */
export class SmsGateSender implements SmsSender {
  readonly name = 'smsgate';
  constructor(private readonly options: { url: string; username: string; password: string; fetchImpl?: typeof fetch }) {}

  async send(to: string, text: string): Promise<void> {
    const auth = Buffer.from(`${this.options.username}:${this.options.password}`).toString('base64');
    const res = await (this.options.fetchImpl ?? fetch)(this.options.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ message: text, phoneNumbers: [to] }),
    });
    await check(res, 'SMS Gateway');
  }
}

/** httpSMS: https://httpsms.com — "from" must be the phone number registered in the httpSMS app. */
export class HttpSmsSender implements SmsSender {
  readonly name = 'httpsms';
  constructor(private readonly options: { apiKey: string; from: string; baseUrl?: string; fetchImpl?: typeof fetch }) {}

  async send(to: string, text: string): Promise<void> {
    const res = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl ?? 'https://api.httpsms.com'}/v1/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.options.apiKey },
      body: JSON.stringify({ content: text, from: this.options.from, to }),
    });
    await check(res, 'httpSMS');
  }
}

export type SmsKind = 'ticket_issued' | 'car_ready' | 'car_reparked' | 'receipt' | 'payment_rejected';

export interface SmsLogEntry {
  id: string;
  at: string;
  kind: SmsKind;
  ticketNumber: string;
  to: string;
  text: string;
  /** awaiting_tap / opened: tap-to-send messages waiting for, or opened by, staff. */
  status: 'sending' | 'sent' | 'failed' | 'awaiting_tap' | 'opened';
  attempts: number;
  error?: string;
}

/** What the app needs to open the phone's Messages app with the message filled in. */
export interface SmsDraft {
  id: string;
  to: string;
  text: string;
}

/**
 * Sends guest messages in the background so API calls never wait on the phone, retrying failed
 * sends up to 3 times and keeping the delivery status of recent messages (FR-NOT-04).
 */
export class Notifier {
  private readonly log: SmsLogEntry[] = [];

  constructor(
    private currentSender: SmsSender,
    private readonly options: { retries?: number; retryDelayMs?: number; keep?: number } = {},
  ) {}

  get sender(): SmsSender {
    return this.currentSender;
  }

  /** Switches the sending method, e.g. after an admin changes the SMS settings. */
  setSender(sender: SmsSender): void {
    this.currentSender = sender;
  }

  /**
   * Queues a message, or for tap-to-send records it for staff to send. Returns the entry, or null
   * when the number is not a valid mobile number.
   */
  send(kind: SmsKind, ticketNumber: string, mobile: string | null | undefined, text: string): SmsLogEntry | null {
    const to = mobile ? normalizeMobile(mobile) : null;
    if (!to || this.sender.name === 'off') return null;
    const entry: SmsLogEntry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      kind,
      ticketNumber,
      to,
      text,
      status: this.sender.manual ? 'awaiting_tap' : 'sending',
      attempts: 0,
    };
    this.log.unshift(entry);
    this.log.splice(this.options.keep ?? 50);
    if (!this.sender.manual) void this.deliver(entry);
    return { ...entry };
  }

  /** Staff opened a tap-to-send message in their Messages app. */
  markOpened(id: string): boolean {
    const entry = this.log.find((e) => e.id === id);
    if (!entry || !this.sender.manual) return false;
    entry.status = 'opened';
    entry.attempts += 1;
    return true;
  }

  private async deliver(entry: SmsLogEntry): Promise<void> {
    const attempts = 1 + (this.options.retries ?? 3);
    for (let i = 0; i < attempts; i++) {
      entry.attempts = i + 1;
      try {
        await this.sender.send(entry.to, entry.text);
        entry.status = 'sent';
        entry.error = undefined;
        return;
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err);
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, (this.options.retryDelayMs ?? 2000) * 2 ** i));
      }
    }
    entry.status = 'failed';
    console.error(`SMS to ${entry.to} for ticket ${entry.ticketNumber} failed after ${entry.attempts} attempts: ${entry.error}`);
  }

  recent(): SmsLogEntry[] {
    return this.log.map((e) => ({ ...e }));
  }
}

/** Message texts; kept short so most fit in one or two SMS segments. */
export const SMS_TEXT = {
  ticketIssued: (p: { app: string; plate: string; location: string; ticket: string; pin: string; link: string }) =>
    `${p.app}: Car ${p.plate} parked at ${p.location}. Ticket ${p.ticket}, PIN (OTP) ${p.pin}. Your ticket QR, and request your car before you arrive: ${p.link}`,
  carReady: (p: { app: string; plate: string; pickup: string; link: string }) =>
    `${p.app}: Your car ${p.plate} is ready at ${p.pickup}. Show your ticket QR to the attendant or tell them your PIN (OTP). ${p.link}`,
  carReparked: (p: { app: string; plate: string; link: string }) =>
    `${p.app}: We parked your car ${p.plate} again as we missed you. Request it when you are close: ${p.link}`,
  receipt: (p: { app: string; ticket: string; amount: number; link: string }) =>
    `${p.app}: Thank you! Ticket ${p.ticket} closed. ${p.amount > 0 ? `Paid Rs ${p.amount}.` : 'No charge.'} Receipt and rating: ${p.link}`,
  paymentRejected: (p: { app: string; ticket: string; link: string }) =>
    `${p.app}: We could not find your payment for ticket ${p.ticket}. Check the reference or pay at the desk: ${p.link}`,
};
