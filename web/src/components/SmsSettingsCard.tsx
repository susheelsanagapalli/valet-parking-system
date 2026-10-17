import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAction, usePolling } from '../hooks';
import { SendSmsButton, type SmsDraft } from './SendSmsButton';

type PhoneType = 'iphone' | 'android';

interface SmsSetup {
  settings: {
    phoneType: PhoneType;
    senderNumber: string;
    android?: { url: string; username: string; hasPassword: boolean };
  } | null;
  activeMethod: string;
  androidDownload: string;
  androidReleases: string;
  androidDocs: string;
  androidCloudUrl: string;
}

function useQr(text: string | null): string | null {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (text) void QRCode.toDataURL(text, { margin: 1, width: 320 }).then(setQr);
    else setQr(null);
  }, [text]);
  return qr;
}

const METHOD_LABEL: Record<string, string> = {
  manual: 'iPhone tap-to-send',
  smsgate: 'Android automatic sending',
  httpsms: 'Android (httpSMS)',
  log: 'test mode — messages are not sent',
  off: 'off',
};

/** Guest SMS set-up from the admin panel: sender number, iPhone or Android, app download and a test message. */
export function SmsSettingsCard() {
  const loaded = usePolling(() => api<SmsSetup>('/sms/config'), [], 0);
  const [phoneType, setPhoneType] = useState<PhoneType>('iphone');
  const [senderNumber, setSenderNumber] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [testTo, setTestTo] = useState('');
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; sentTo?: string; error?: string; smsDraft?: SmsDraft | null } | null>(null);
  const save = useAction();
  const test = useAction();

  const setup = loaded.data;
  useEffect(() => {
    const s = setup?.settings;
    if (!s) return;
    setPhoneType(s.phoneType);
    setSenderNumber(s.senderNumber);
    setUsername(s.android?.username ?? '');
    setUrl(s.android?.url && s.android.url !== setup.androidCloudUrl ? s.android.url : '');
  }, [setup]);

  const staffAppUrl = `${window.location.origin}/login`;
  const androidQr = useQr(phoneType === 'android' && setup ? setup.androidDownload : null);
  const iphoneQr = useQr(phoneType === 'iphone' ? staffAppUrl : null);

  if (!setup) return <div className="card muted">{loaded.error ?? 'Loading SMS settings…'}</div>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const res = await save.run(() =>
      api<SmsSetup>('/sms/config', {
        method: 'PUT',
        body: { phoneType, senderNumber, android: phoneType === 'android' ? { username, password: password || undefined, url: url || undefined } : undefined },
      }),
    );
    if (res) {
      loaded.setData(res);
      setPassword('');
      setSaved(true);
    }
  }

  async function sendTest() {
    setTestResult(null);
    const res = await test.run(() => api<{ ok: boolean; sentTo?: string; error?: string; smsDraft?: SmsDraft | null }>('/sms/test', { body: { to: testTo || undefined } }));
    if (res) setTestResult(res);
  }

  const isLocalhost = /localhost|127\.0\.0\.1/.test(window.location.hostname);
  const savedType = setup.settings?.phoneType;

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)}>
      <h2>Guest SMS</h2>
      <p className="muted" style={{ margin: 0 }}>
        Guests get their ticket link and PIN, “car ready”, and a receipt by SMS from your own mobile number. Now: <strong>{METHOD_LABEL[setup.activeMethod] ?? setup.activeMethod}</strong>
      </p>

      <label>
        Sender mobile number
        <span className="hint">The SIM that sends the messages</span>
        <input value={senderNumber} onChange={(e) => setSenderNumber(e.target.value)} inputMode="tel" placeholder="9515858993" required />
      </label>

      <div className="stack" style={{ gap: 6 }}>
        <strong>That SIM is in an</strong>
        <div className="segmented" role="radiogroup" aria-label="Phone type">
          {(
            [
              ['iphone', 'iPhone'],
              ['android', 'Android phone'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={phoneType === value}
              className={phoneType === value ? 'selected' : ''}
              onClick={() => {
                setPhoneType(value);
                setSaved(false);
                setTestResult(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {phoneType === 'iphone' ? (
        <div className="stack">
          <div className="notice ok">
            <strong>No app to download.</strong> iPhones don't let apps send SMS by themselves, so messages are sent with one tap: after check-in, “car ready” and handover, the app shows a{' '}
            <strong>Send SMS</strong> button that opens iPhone Messages with the guest's number and text filled in. Tap Send and it goes from this iPhone's number.
          </div>
          <strong>Set up the iPhone (once)</strong>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>On the iPhone with the {senderNumber || 'sender'} SIM, open the staff app in Safari: scan this QR with the iPhone camera or type the address.</li>
            <li>
              Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, so it opens like an app.
            </li>
            <li>Sign in as the attendant who checks cars in. Use this iPhone for check-in and handover so the SMS go from {senderNumber || 'this number'}.</li>
          </ol>
          <div className="row">
            {iphoneQr && <img className="qr" src={iphoneQr} alt="QR code for the staff app address" style={{ width: 160, height: 160 }} />}
            <a href={staffAppUrl} className="mono wrap">
              {staffAppUrl}
            </a>
          </div>
          {isLocalhost && (
            <div className="notice warn">
              This address uses “localhost”, which only works on this computer. On the iPhone, use this computer's network address instead (e.g. http://192.168.x.x:8080/login), with both on the same Wi-Fi.
            </div>
          )}
        </div>
      ) : (
        <div className="stack">
          <div className="notice ok">
            <strong>Fully automatic.</strong> The free <strong>SMS Gateway for Android</strong> app on the Android phone with the {senderNumber || 'sender'} SIM sends every message by itself. Keep that phone switched on, charged and online.
          </div>
          <strong>Set up the Android phone (once)</strong>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              On the Android phone, scan this QR or open the link to download the app (APK). It isn't on Google Play; this is the official download from the developer's GitHub page.
            </li>
            <li>Open the downloaded file and allow “Install unknown apps” when asked. On Android 15+, if Play Protect blocks it, pause Play Protect while installing.</li>
            <li>Open the app, allow it to send SMS, switch on <strong>Cloud server</strong>, and tap <strong>Online</strong>.</li>
            <li>Copy the <strong>username</strong> and <strong>password</strong> the app shows into the fields below, then save and send a test.</li>
          </ol>
          <div className="row">
            {androidQr && <img className="qr" src={androidQr} alt="QR code to download SMS Gateway for Android" style={{ width: 160, height: 160 }} />}
            <div className="stack" style={{ gap: 6 }}>
              <a className="button primary" href={setup.androidDownload}>
                Download SMS Gateway for Android (APK)
              </a>
              <a href={setup.androidReleases} target="_blank" rel="noreferrer">
                Release notes and other versions
              </a>
              <a href={setup.androidDocs} target="_blank" rel="noreferrer">
                Installation guide
              </a>
            </div>
          </div>
          <div className="grid">
            <label>
              Gateway username
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" required={phoneType === 'android'} />
            </label>
            <label>
              Gateway password
              <span className="hint">{setup.settings?.android?.hasPassword ? 'Saved. Leave empty to keep it.' : 'From the app'}</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required={phoneType === 'android' && !setup.settings?.android?.hasPassword} />
            </label>
            <label>
              Local server address (optional)
              <span className="hint">Only if you use the app's Local server instead of Cloud, e.g. http://192.168.1.20:8080/message</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={setup.androidCloudUrl} />
            </label>
          </div>
        </div>
      )}

      {save.error && <div className="notice error">{save.error}</div>}
      {saved && <div className="notice ok">SMS settings saved.</div>}
      <button className="primary big" type="submit" disabled={save.busy}>
        {save.busy ? 'Saving…' : 'Save SMS settings'}
      </button>

      {savedType && savedType !== phoneType && <div className="notice warn">Save to switch guest SMS to {phoneType === 'iphone' ? 'iPhone tap-to-send' : 'the Android phone'}.</div>}
      {savedType === phoneType && (
        <div className="stack">
          <h3>Send a test SMS</h3>
          <div className="row">
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} inputMode="tel" placeholder={`To (default ${setup.settings?.senderNumber ?? ''})`} style={{ flex: 1, minWidth: 180 }} aria-label="Test SMS recipient" />
            <button type="button" disabled={test.busy} onClick={() => void sendTest()}>
              {test.busy ? 'Sending…' : 'Send test'}
            </button>
          </div>
          {test.error && <div className="notice error">{test.error}</div>}
          {testResult?.ok && testResult.sentTo && <div className="notice ok">Test SMS sent to {testResult.sentTo} through the Android phone. It should arrive within a minute.</div>}
          {testResult && !testResult.ok && <div className="notice error">The Android phone could not send it: {testResult.error}. Check the username, password and that the app shows Online.</div>}
          {testResult?.smsDraft && <SendSmsButton draft={testResult.smsDraft} label="Open test SMS in Messages" />}
        </div>
      )}
    </form>
  );
}
