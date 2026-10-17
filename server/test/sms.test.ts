import { describe, expect, it } from 'vitest';
import { HttpSmsSender, ManualSmsSender, Notifier, SmsGateSender, normalizeMobile, type SmsSender } from '../src/sms.js';

function fakeFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(status === 200 ? '{}' : 'nope', { status });
  }) as typeof fetch;
  return { impl, calls };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('normalizeMobile', () => {
  it('formats Indian numbers as +91 and keeps international ones', () => {
    expect(normalizeMobile('9515858993')).toBe('+919515858993');
    expect(normalizeMobile('+91 95158 58993')).toBe('+919515858993');
    expect(normalizeMobile('095158 58993')).toBe('+919515858993');
    expect(normalizeMobile('919515858993')).toBe('+919515858993');
    expect(normalizeMobile('+447700900123')).toBe('+447700900123');
    expect(normalizeMobile('12345')).toBeNull();
  });
});

describe('gateways', () => {
  it('SMS Gateway for Android: basic auth and phoneNumbers list', async () => {
    const f = fakeFetch();
    await new SmsGateSender({ url: 'https://api.sms-gate.app/3rdparty/v1/message', username: 'u', password: 'p', fetchImpl: f.impl }).send('+919800000001', 'Hi');
    const call = f.calls[0];
    expect(call?.url).toBe('https://api.sms-gate.app/3rdparty/v1/message');
    expect((call?.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
    expect(JSON.parse(String(call?.init.body))).toEqual({ message: 'Hi', phoneNumbers: ['+919800000001'] });
  });

  it('httpSMS: API key and from number', async () => {
    const f = fakeFetch();
    await new HttpSmsSender({ apiKey: 'key', from: '+919515858993', fetchImpl: f.impl }).send('+919800000001', 'Hi');
    const call = f.calls[0];
    expect(call?.url).toBe('https://api.httpsms.com/v1/messages/send');
    expect((call?.init.headers as Record<string, string>)['x-api-key']).toBe('key');
    expect(JSON.parse(String(call?.init.body))).toEqual({ content: 'Hi', from: '+919515858993', to: '+919800000001' });
  });

  it('reports HTTP errors', async () => {
    const f = fakeFetch(401);
    await expect(new HttpSmsSender({ apiKey: 'bad', from: '+919515858993', fetchImpl: f.impl }).send('+919800000001', 'Hi')).rejects.toThrow(/401/);
  });
});

describe('Notifier', () => {
  it('retries failed sends and records the delivery status', async () => {
    let failures = 2;
    const sent: string[] = [];
    const sender: SmsSender = {
      name: 'test',
      async send(to) {
        if (failures-- > 0) throw new Error('phone offline');
        sent.push(to);
      },
    };
    const notifier = new Notifier(sender, { retryDelayMs: 1 });
    expect(notifier.send('ticket_issued', 'T1', '9800000001', 'hello')).toMatchObject({ status: 'sending', to: '+919800000001' });
    await until(() => notifier.recent()[0]?.status === 'sent');
    expect(notifier.recent()[0]).toMatchObject({ status: 'sent', attempts: 3, to: '+919800000001' });
    expect(sent).toEqual(['+919800000001']);
  });

  it('gives up after 3 retries', async () => {
    const notifier = new Notifier({ name: 'down', send: async () => Promise.reject(new Error('down')) }, { retryDelayMs: 1 });
    notifier.send('car_ready', 'T2', '9800000002', 'ready');
    await until(() => notifier.recent()[0]?.status === 'failed');
    expect(notifier.recent()[0]).toMatchObject({ status: 'failed', attempts: 4, error: 'down' });
  });

  it('skips invalid numbers', () => {
    const notifier = new Notifier({ name: 'x', send: async () => undefined });
    expect(notifier.send('receipt', 'T3', '123', 'x')).toBeNull();
    expect(notifier.recent()).toHaveLength(0);
  });

  it('tap-to-send: records the message for staff and never calls a gateway', () => {
    const notifier = new Notifier(new ManualSmsSender());
    const entry = notifier.send('ticket_issued', 'T4', '9515858993', 'hello');
    expect(entry).toMatchObject({ status: 'awaiting_tap', to: '+919515858993', attempts: 0 });
    expect(notifier.markOpened(entry?.id ?? '')).toBe(true);
    expect(notifier.recent()[0]).toMatchObject({ status: 'opened', attempts: 1 });
    expect(notifier.markOpened('nope')).toBe(false);
  });
});
