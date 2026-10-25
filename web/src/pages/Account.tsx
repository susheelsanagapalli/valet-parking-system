import { KeyRound, MapPin, ShieldCheck, User } from 'lucide-react';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { useSession } from '../session';

/** The signed-in user's own account: who they are, and changing their password. */
export function AccountPage() {
  const { user, locations } = useSession();
  if (!user) return null;
  const where = user.locations === 'all' ? 'All locations' : locations.filter((l) => user.locations.includes(l.id)).map((l) => l.name).join(', ') || '—';
  return (
    <div className="stack">
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="page-title">
          <span className="icon-tile tone-info" aria-hidden>
            <User size={22} />
          </span>
          <div>
            <h1>{user.name}</h1>
            <p className="muted">Signed in as {user.username}</p>
          </div>
        </div>
        <div className="detail-list">
          <div className="detail-row">
            <ShieldCheck size={18} aria-hidden />
            <span className="k">Role</span>
            <span className="v">{user.roleName}</span>
          </div>
          <div className="detail-row">
            <MapPin size={18} aria-hidden />
            <span className="k">Locations</span>
            <span className="v">{where}</span>
          </div>
          {user.passwordChangedAt && (
            <div className="detail-row">
              <KeyRound size={18} aria-hidden />
              <span className="k">Password</span>
              <span className="v">Changed {new Date(user.passwordChangedAt).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <h2>Change password</h2>
        <ChangePasswordForm />
      </div>
    </div>
  );
}

/** Shown instead of the app until a user replaces the password an admin gave them. */
export function FirstPasswordPage() {
  const { user, logout } = useSession();
  return (
    <div className="guest-shell" style={{ paddingTop: 32 }}>
      <div className="card fade-in">
        <div className="page-title">
          <span className="icon-tile tone-warn" aria-hidden>
            <KeyRound size={22} />
          </span>
          <div>
            <h1>Choose your password</h1>
            <p className="muted">Welcome, {user?.name}. Replace the password you were given with one only you know.</p>
          </div>
        </div>
        <ChangePasswordForm />
      </div>
      <p className="center">
        <button type="button" onClick={logout}>
          Sign out
        </button>
      </p>
    </div>
  );
}
