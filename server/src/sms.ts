/**
 * Guest SMS (SRS FR-NOT-01, FR-NOT-04, FR-NOT-05).
 *
 * To send from the operator's own mobile number without a paid SMS provider, an Android phone with
 * that SIM acts as the gateway, through one of two free apps:
 * - SMS Gateway for Android (sms-gate.app): cloud or local-network API, basic auth.
 * - httpSMS (httpsms.com): cloud API with an API key; the free plan has a monthly limit.
 * "log" prints messages instead of sending them, for development and testing.
 */

export interface SmsSender {
  readonly name: string;
  send(to: string, text: string): Promise<void>;
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
  at: string;
  kind: SmsKind;
  ticketNumber: string;
  to: string;
  text: string;
  status: 'sending' | 'sent' | 'failed';
  attempts: number;
  error?: string;
}

/**
 * Sends guest messages in the background so API calls never wait on the phone, retrying failed
 * sends up to 3 times and keeping the delivery status of recent messages (FR-NOT-04).
 */
export class Notifier {
  private readonly log: SmsLogEntry[] = [];

  constructor(
    readonly sender: SmsSender,
    private readonly options: { retries?: number; retryDelayMs?: number; keep?: number } = {},
  ) {}

  /** Queues a message; returns false when the number is not a valid mobile number. */
  send(kind: SmsKind, ticketNumber: string, mobile: string | null | undefined, text: string): boolean {
    const to = mobile ? normalizeMobile(mobile) : null;
    if (!to) return false;
    const entry: SmsLogEntry = { at: new Date().toISOString(), kind, ticketNumber, to, text, status: 'sending', attempts: 0 };
    this.log.unshift(entry);
    this.log.splice(this.options.keep ?? 50);
    void this.deliver(entry);
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
    `${p.app}: Car ${p.plate} parked at ${p.location}. Ticket ${p.ticket}, handover PIN ${p.pin}. Request your car before you arrive: ${p.link}`,
  carReady: (p: { app: string; plate: string; pickup: string; link: string }) =>
    `${p.app}: Your car ${p.plate} is ready at ${p.pickup}. Show your ticket QR or say your PIN. ${p.link}`,
  carReparked: (p: { app: string; plate: string; link: string }) =>
    `${p.app}: We parked your car ${p.plate} again as we missed you. Request it when you are close: ${p.link}`,
  receipt: (p: { app: string; ticket: string; amount: number; link: string }) =>
    `${p.app}: Thank you! Ticket ${p.ticket} closed. ${p.amount > 0 ? `Paid Rs ${p.amount}.` : 'No charge.'} Receipt and rating: ${p.link}`,
  paymentRejected: (p: { app: string; ticket: string; link: string }) =>
    `${p.app}: We could not find your payment for ticket ${p.ticket}. Check the reference or pay at the desk: ${p.link}`,
};
