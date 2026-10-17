import { useState } from 'react';
import { api } from '../api';

export interface SmsDraft {
  id: string;
  to: string;
  text: string;
}

/**
 * Tap-to-send: opens the phone's Messages app with the guest's number and message filled in. On
 * iPhone and Android the message goes from that phone's own number when staff tap Send.
 */
export function smsHref(draft: SmsDraft): string {
  // "?&body=" is understood by both iOS ("&body=") and Android ("?body=").
  return `sms:${draft.to}?&body=${encodeURIComponent(draft.text)}`;
}

export function SendSmsButton({ draft, label = 'Send SMS to guest' }: { draft: SmsDraft; label?: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <a
        className={`button ${opened ? '' : 'primary'}`}
        href={smsHref(draft)}
        onClick={() => {
          setOpened(true);
          void api(`/sms/${draft.id}/opened`, { body: {} }).catch(() => undefined);
        }}
      >
        {opened ? `Open SMS again (${draft.to})` : `${label} (${draft.to})`}
      </a>
      <span className="muted wrap" style={{ fontSize: '0.85rem' }}>
        {opened ? 'Messages opened — tap Send there.' : draft.text}
      </span>
    </div>
  );
}
