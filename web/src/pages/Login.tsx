import { Car, LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { TestCredentials } from '../components/TestCredentials';
import { useAction } from '../hooks';
import { useSession } from '../session';

export function LoginPage() {
  const { user, login } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  if (user) return <Navigate to="/staff" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(() => login(username, password));
  }

  return (
    <div className="guest-shell" style={{ paddingTop: 48 }}>
      <div className="card fade-in">
        <div className="page-title">
          <span className="icon-tile tone-info" aria-hidden>
            <Car size={22} />
          </span>
          <div>
            <h1>Staff sign in</h1>
            <p className="muted">Valet attendant console</p>
          </div>
        </div>
        <form className="stack" onSubmit={(e) => void submit(e)}>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && <div className="notice error">{error}</div>}
          <button className="primary big" type="submit" disabled={busy}>
            <LogIn size={22} aria-hidden />
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
      <p className="muted center">Guests: open the link from your ticket SMS to see your car.</p>
      <TestCredentials
        onUse={(u, p) => {
          setUsername(u);
          setPassword(p);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
}
