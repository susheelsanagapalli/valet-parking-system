import { Car, Database, LayoutDashboard, ListOrdered, LogIn, LogOut, QrCode, Settings, Wallet, WifiOff, type LucideIcon } from 'lucide-react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { IS_BROWSER_DEMO } from '../api';
import { useOnline } from '../online';
import { NewLocationCard } from './Settings';
import { useSession } from '../session';

const TABS: Array<{ to: string; label: string; permission: string; icon: LucideIcon }> = [
  { to: 'check-in', label: 'Check in', permission: 'tickets.check_in', icon: LogIn },
  { to: 'queue', label: 'Queue', permission: 'tasks.accept', icon: ListOrdered },
  { to: 'cars', label: 'Cars', permission: 'tickets.view', icon: Car },
  { to: 'payments', label: 'Payments', permission: 'payments.verify', icon: Wallet },
  { to: 'dashboard', label: 'Dashboard', permission: 'reports.view', icon: LayoutDashboard },
  { to: 'settings', label: 'Settings', permission: 'locations.settings', icon: Settings },
  { to: 'data', label: 'Data', permission: 'data.manage', icon: Database },
  { to: 'qr-approvals', label: 'QR approvals', permission: 'payment_qr.approve', icon: QrCode },
];

export function StaffLayout() {
  const { user, loading, locations, location, setLocationId, logout, can, reloadLocations } = useSession();
  const online = useOnline();
  if (loading) return <main className="muted">Loading…</main>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <>
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden>
            <Car size={18} />
          </span>
          {location?.app_name ?? 'Valet'}
        </span>
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
        <button type="button" onClick={logout} aria-label="Sign out">
          <LogOut size={18} aria-hidden />
          <span className="hide-sm" aria-hidden>
            Sign out
          </span>
        </button>
      </header>
      <nav className="tabs">
        {TABS.filter((t) => can(t.permission) && !(IS_BROWSER_DEMO && t.to === 'data')).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon size={20} aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      {!online && (
        <div className="notice warn label-text" role="status" style={{ borderRadius: 0, justifyContent: 'center' }}>
          <WifiOff size={18} aria-hidden /> No internet connection. You can keep filling in forms; save when the signal is back.
        </div>
      )}
      <main>
        {location ? (
          <Outlet />
        ) : can('locations.manage') ? (
          // A new installation has no locations, and every page needs one, so the first is created here.
          <div className="stack">
            <div className="notice warn">No locations yet. Create the first one to start.</div>
            <NewLocationCard
              onCreated={async (l) => {
                await reloadLocations();
                setLocationId(l.id);
              }}
            />
          </div>
        ) : (
          <div className="card">No locations yet. An operator admin needs to create one first.</div>
        )}
      </main>
    </>
  );
}

export function StaffHome() {
  const { can } = useSession();
  const first = TABS.find((t) => can(t.permission));
  return <Navigate to={first ? first.to : 'cars'} replace />;
}
