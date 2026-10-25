import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAction } from '../hooks';
import { MIN_PASSWORD_LENGTH } from '../password';
import { useSession } from '../session';

/** The signed-in user changes their own password. */
export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const { changePassword, user } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== repeat) {
      setError('The new passwords do not match');
      return;
    }
    const ok = await run(async () => {
      await changePassword(current, next);
      return true;
    });
    if (ok) {
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
      onDone?.();
    }
  }

  const type = show ? 'text' : 'password';
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <input type="text" name="username" autoComplete="username" value={user?.username ?? ''} readOnly hidden />
      <label>
        Current password
        {user?.mustChangePassword && <span className="hint">The password your admin gave you</span>}
        <input type={type} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </label>
      <label>
        New password
        <span className="hint">At least {MIN_PASSWORD_LENGTH} characters. A short sentence is easy to remember and hard to guess.</span>
        <input type={type} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
      </label>
      {tooShort && <span className="muted">{MIN_PASSWORD_LENGTH - next.length} more characters</span>}
      <label>
        Repeat the new password
        <input type={type} value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required />
      </label>
      <label className="check">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />} Show passwords
      </label>
      {error && <div className="notice error">{error}</div>}
      {done && !error && <div className="notice ok">Password changed. You stay signed in here; other devices are signed out.</div>}
      <button className="primary big" type="submit" disabled={busy || next.length < MIN_PASSWORD_LENGTH || !current || !repeat}>
        <KeyRound size={22} aria-hidden />
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
