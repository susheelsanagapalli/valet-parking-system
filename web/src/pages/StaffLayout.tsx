import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { IS_BROWSER_DEMO } from '../api';
import { useSession } from '../session';

const TABS: Array<{ to: string; label: string; permission: string }> = [
  { to: 'check-in', label: 'Check in', permission: 'tickets.check_in' },
  { to: 'queue', label: 'Queue', permission: 'tasks.accept' },
  { to: 'cars', label: 'Cars', permission: 'tickets.view' },
  { to: 'payments', label: 'Payments', permission: 'payments.verify' },
  { to: 'dashboard', label: 'Dashboard', permission: 'reports.view' },
  { to: 'settings', label: 'Settings', permission: 'locations.settings' },
  { to: 'data', label: 'Data', permission: 'data.manage' },
  { to: 'qr-approvals', label: 'QR approvals', permission: 'payment_qr.approve' },
];

export function StaffLayout() {
  const { user, loading, locations, location, setLocationId, logout, can } = useSession();
  if (loading) return <main className="muted">Loading…</main>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <>
      <header className="topbar">
        <span className="brand">{location?.app_name ?? 'Valet'}</span>
        {locations.length > 0 && (
          <select value={location?.id ?? ''} onChange={(e) => setLocationId(e.target.value)} aria-label="Location">
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <span className="hide-sm">{user.name}</span>
        <button type="button" onClick={logout}>
          Sign out
        </button>
      </header>
      <nav className="tabs">
        {TABS.filter((t) => can(t.permission) && !(IS_BROWSER_DEMO && t.to === 'data')).map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <main>{location ? <Outlet /> : <div className="card">No locations yet. An operator admin can create one under Settings.</div>}</main>
    </>
  );
}

export function StaffHome() {
  const { can } = useSession();
  const first = TABS.find((t) => can(t.permission));
  return <Navigate to={first ? first.to : 'cars'} replace />;
}
