import { Ban, Check, Copy, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { useAction, usePolling } from '../hooks';
import { MIN_PASSWORD_LENGTH, generatePassword } from '../password';
import { useSession } from '../session';
import type { LocationRow, RoleInfo, RolesResponse, StaffRow } from '../types';

type Locations = string[] | 'all';

/** Staff accounts and roles, for platform and operator admins (permission users.manage). */
export function StaffPage() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const users = usePolling(() => api<StaffRow[]>('/staff/users'), [], 0);
  const roles = usePolling(() => api<RolesResponse>('/staff/roles'), [], 0);
  const refresh = async () => {
    await Promise.all([users.refresh(), roles.refresh()]);
  };

  return (
    <div className="stack">
      <div className="page-title" style={{ marginBottom: 0 }}>
        <span className="icon-tile tone-indigo" aria-hidden>
          <Users size={22} />
        </span>
        <div>
          <h1>Staff</h1>
          <p className="muted">Accounts, roles and which locations each person can work at.</p>
        </div>
      </div>
      <div className="segmented" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'selected' : ''} onClick={() => setTab('users')}>
          <Users size={18} aria-hidden /> Users
        </button>
        <button type="button" role="tab" aria-selected={tab === 'roles'} className={tab === 'roles' ? 'selected' : ''} onClick={() => setTab('roles')}>
          <ShieldCheck size={18} aria-hidden /> Roles
        </button>
      </div>
      {(users.error || roles.error) && <div className="notice error">{users.error ?? roles.error}</div>}
      {tab === 'users' ? (
        <UsersTab users={users.data} roles={roles.data?.roles ?? []} onChanged={refresh} />
      ) : (
        <RolesTab data={roles.data} onChanged={refresh} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ users

function locationSummary(locations: Locations, all: LocationRow[]): string {
  if (locations === 'all') return 'All locations';
  const names = locations.map((id) => all.find((l) => l.id === id)?.name ?? 'Other location');
  return names.join(', ') || '—';
}

function UsersTab({ users, roles, onChanged }: { users: StaffRow[] | null; roles: RoleInfo[]; onChanged: () => Promise<void> }) {
  const { locations } = useSession();
  const [editing, setEditing] = useState<StaffRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<StaffRow | null>(null);
  const [deleting, setDeleting] = useState<StaffRow | null>(null);
  const [handout, setHandout] = useState<{ username: string; password: string; name: string } | null>(null);
  const action = useAction();

  const toggle = async (u: StaffRow) => {
    if (await action.run(() => api(`/staff/users/${u.id}`, { method: 'PUT', body: { disabled: !u.disabled } }))) await onChanged();
  };

  return (
    <div className="card">
      <div className="card-title">
        <h2>Users</h2>
        <span className="muted tabular">{users?.length ?? ''}</span>
        <button type="button" className="primary end" onClick={() => setEditing('new')}>
          <UserPlus size={18} aria-hidden /> Add user
        </button>
      </div>
      {action.error && <div className="notice error">{action.error}</div>}
      {users?.length === 0 && <EmptyState icon={Users} title="No users yet" />}
      <div className="list">
        {users?.map((u) => (
          <div key={u.id} className="list-row" style={{ flexWrap: 'wrap', opacity: u.disabled ? 0.6 : 1 }}>
            <span className={`icon-tile sm ${u.disabled ? '' : 'tone-info'}`} aria-hidden>
              {u.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="main">
              <span className="line">
                <strong>{u.name}</strong>
                <span className="muted mono">{u.username}</span>
                {u.self && <span className="pill info">You</span>}
                {u.disabled && <span className="pill">Switched off</span>}
                {u.mustChangePassword && !u.disabled && <span className="pill">Must set password</span>}
              </span>
              <span className="sub">
                {u.roleName} · {locationSummary(u.locations, locations)}
              </span>
            </span>
            {u.manageable && !u.self && (
              <span className="row">
                <button type="button" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}>
                  <Pencil size={18} aria-hidden /> Edit
                </button>
                <button type="button" onClick={() => setResetting(u)} aria-label={`Reset password for ${u.name}`}>
                  <KeyRound size={18} aria-hidden /> Password
                </button>
                <button type="button" disabled={action.busy} onClick={() => void toggle(u)} aria-label={`${u.disabled ? 'Switch on' : 'Switch off'} ${u.name}`}>
                  {u.disabled ? <Check size={18} aria-hidden /> : <Ban size={18} aria-hidden />}
                  {u.disabled ? 'Switch on' : 'Switch off'}
                </button>
                <button type="button" className="danger" onClick={() => setDeleting(u)} aria-label={`Delete ${u.name}`}>
                  <Trash2 size={18} aria-hidden />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add user' : `Edit ${editing?.name ?? ''}`}>
        {editing !== null && (
          <UserForm
            user={editing === 'new' ? null : editing}
            roles={roles}
            onSaved={async (created) => {
              setEditing(null);
              if (created) setHandout(created);
              await onChanged();
            }}
          />
        )}
      </Modal>

      <Modal open={resetting !== null} onClose={() => setResetting(null)} title={`New password for ${resetting?.name ?? ''}`} narrow>
        {resetting && (
          <ResetPasswordForm
            user={resetting}
            onSaved={async (password) => {
              setHandout({ username: resetting.username, password, name: resetting.name });
              setResetting(null);
              await onChanged();
            }}
          />
        )}
      </Modal>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name ?? ''}?`} narrow>
        {deleting && (
          <div className="stack">
            <p style={{ margin: 0 }}>
              {deleting.name} ({deleting.username}) can no longer sign in, and the account can't be restored. To stop someone temporarily, use <strong>Switch off</strong>{' '}
              instead.
            </p>
            {action.error && <div className="notice error">{action.error}</div>}
            <button
              type="button"
              className="danger big"
              disabled={action.busy}
              onClick={async () => {
                if (await action.run(() => api(`/staff/users/${deleting.id}`, { method: 'DELETE' }))) {
                  setDeleting(null);
                  await onChanged();
                }
              }}
            >
              <Trash2 size={20} aria-hidden /> Delete account
            </button>
          </div>
        )}
      </Modal>

      <Modal open={handout !== null} onClose={() => setHandout(null)} title="Give these to the user" narrow>
        {handout && <Handout {...handout} onDone={() => setHandout(null)} />}
      </Modal>
    </div>
  );
}

/** The sign-in details to pass on, shown once. */
function Handout({ name, username, password, onDone }: { name: string; username: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/login\nUsername: ${username}\nPassword: ${password}`;
  return (
    <div className="stack">
      <p style={{ margin: 0 }}>
        Give {name} these sign-in details in person or by a private message. The password is shown only now. At first sign-in they must choose their own.
      </p>
      <div className="detail-list card" style={{ marginBottom: 0 }}>
        <div className="detail-row">
          <span className="k">Username</span>
          <span className="v mono">{username}</span>
        </div>
        <div className="detail-row">
          <span className="k">Password</span>
          <span className="v mono" style={{ fontSize: '1.2rem' }}>
            {password}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
        {copied ? 'Copied' : 'Copy sign-in details'}
      </button>
      <button type="button" className="primary" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label>
      Starting password
      <span className="hint">At least {MIN_PASSWORD_LENGTH} characters. The user must change it at first sign-in.</span>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input className="mono" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required style={{ flex: 1 }} />
        <button type="button" onClick={() => onChange(generatePassword())} aria-label="Generate a password">
          <RefreshCw size={18} aria-hidden /> Generate
        </button>
      </div>
    </label>
  );
}

function LocationPicker({ value, onChange }: { value: Locations; onChange: (v: Locations) => void }) {
  const { locations, user } = useSession();
  const canAll = user?.locations === 'all';
  const picked = value === 'all' ? [] : value;
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
      <legend style={{ fontWeight: 600, marginBottom: 6 }}>Locations</legend>
      {canAll && (
        <label className="check">
          <input type="checkbox" checked={value === 'all'} onChange={(e) => onChange(e.target.checked ? 'all' : [])} />
          All locations, including ones created later
        </label>
      )}
      {value !== 'all' &&
        locations.map((l) => (
          <label className="check" key={l.id}>
            <input
              type="checkbox"
              checked={picked.includes(l.id)}
              onChange={(e) => onChange(e.target.checked ? [...picked, l.id] : picked.filter((id) => id !== l.id))}
            />
            {l.name}
          </label>
        ))}
    </fieldset>
  );
}

function UserForm({ user, roles, onSaved }: { user: StaffRow | null; roles: RoleInfo[]; onSaved: (created?: { username: string; password: string; name: string }) => Promise<void> }) {
  const { user: me } = useSession();
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [role, setRole] = useState(user?.role ?? 'attendant');
  const [locations, setLocations] = useState<Locations>(user?.locations ?? (me?.locations === 'all' ? 'all' : (me?.locations ?? [])));
  const [password, setPassword] = useState(() => (user ? '' : generatePassword()));
  const { busy, error, run } = useAction();
  const choices = roles.filter((r) => r.manageable);
  const selected = roles.find((r) => r.id === role);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = user
      ? await run(() => api(`/staff/users/${user.id}`, { method: 'PUT', body: { name, role, locations } }))
      : await run(() => api('/staff/users', { body: { name, username, role, locations, password } }));
    if (ok) await onSaved(user ? undefined : { username: username.trim().toLowerCase(), password, name });
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Full name
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
      </label>
      {!user && (
        <label>
          Username
          <span className="hint">Lowercase letters, digits, dot, dash or underscore. Can't be changed later.</span>
          <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} required minLength={3} autoCapitalize="none" />
        </label>
      )}
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.builtIn ? '' : ' (custom)'}
            </option>
          ))}
        </select>
        {selected && <span className="hint">{selected.permissions.length} permissions. See the Roles tab for details.</span>}
      </label>
      <LocationPicker value={locations} onChange={setLocations} />
      {!user && <PasswordField value={password} onChange={setPassword} />}
      {error && <div className="notice error">{error}</div>}
      <button className="primary big" type="submit" disabled={busy || (locations !== 'all' && locations.length === 0)}>
        {user ? <Check size={22} aria-hidden /> : <UserPlus size={22} aria-hidden />}
        {busy ? 'Saving…' : user ? 'Save changes' : 'Create user'}
      </button>
    </form>
  );
}

function ResetPasswordForm({ user, onSaved }: { user: StaffRow; onSaved: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState(generatePassword);
  const { busy, error, run } = useAction();
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api(`/staff/users/${user.id}/password`, { body: { password } }))) await onSaved(password);
      }}
    >
      <p style={{ margin: 0 }}>{user.name} is signed out everywhere and must choose a new password at next sign-in.</p>
      <PasswordField value={password} onChange={setPassword} />
      {error && <div className="notice error">{error}</div>}
      <button className="primary big" type="submit" disabled={busy}>
        <KeyRound size={22} aria-hidden /> {busy ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------ roles

function RolesTab({ data, onChanged }: { data: RolesResponse | null; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<RoleInfo | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const action = useAction();
  if (!data) return <p className="muted">Loading…</p>;
  const label = (id: string) => data.permissions.find((p) => p.id === id)?.label ?? id;

  return (
    <div className="card">
      <div className="card-title">
        <h2>Roles</h2>
        <button type="button" className="primary end" onClick={() => setEditing('new')}>
          <Plus size={18} aria-hidden /> New role
        </button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Built-in roles can't be changed. Create a custom role to choose exactly what someone can do, for example a night supervisor who can't verify payments.
      </p>
      {action.error && <div className="notice error">{action.error}</div>}
      <div className="list">
        {data.roles.map((r) => (
          <div key={r.id} className="list-row" style={{ flexWrap: 'wrap' }}>
            <span className={`icon-tile sm ${r.builtIn ? '' : 'tone-purple'}`} aria-hidden>
              <ShieldCheck size={18} />
            </span>
            <span className="main">
              <span className="line">
                <strong>{r.name}</strong>
                <span className={`pill${r.builtIn ? ' info' : ''}`}>{r.builtIn ? 'Built-in' : 'Custom'}</span>
              </span>
              <span className="sub">
                {r.permissions.length} permissions · {r.users} user{r.users === 1 ? '' : 's'}
                {r.description && ` · ${r.description}`}
              </span>
            </span>
            <span className="row">
              <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                {open === r.id ? 'Hide' : 'Permissions'}
              </button>
              {!r.builtIn && r.manageable && (
                <>
                  <button type="button" onClick={() => setEditing(r)} aria-label={`Edit role ${r.name}`}>
                    <Pencil size={18} aria-hidden /> Edit
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={action.busy || r.users > 0}
                    title={r.users > 0 ? 'Give its users another role first' : undefined}
                    aria-label={`Delete role ${r.name}`}
                    onClick={async () => {
                      if (await action.run(() => api(`/staff/roles/${r.id}`, { method: 'DELETE' }))) await onChanged();
                    }}
                  >
                    <Trash2 size={18} aria-hidden />
                  </button>
                </>
              )}
            </span>
            {open === r.id && (
              <ul className="muted fade-in" style={{ width: '100%', margin: '4px 0 0', paddingLeft: 64 }}>
                {r.permissions.map((p) => (
                  <li key={p}>{label(p)}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New role' : `Edit ${editing?.name ?? ''}`}>
        {editing !== null && (
          <RoleForm
            role={editing === 'new' ? null : editing}
            permissions={data.permissions}
            onSaved={async () => {
              setEditing(null);
              await onChanged();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function RoleForm({ role, permissions, onSaved }: { role: RoleInfo | null; permissions: RolesResponse['permissions']; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [picked, setPicked] = useState<string[]>(role?.permissions ?? ['tickets.view']);
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { name, description, permissions: picked };
    const ok = role ? await run(() => api(`/staff/roles/${role.id}`, { method: 'PUT', body })) : await run(() => api('/staff/roles', { body }));
    if (ok) await onSaved();
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <label>
        Role name
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40} placeholder="e.g. Night supervisor" autoFocus />
      </label>
      <label>
        Description (optional)
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
      </label>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>What this role can do</legend>
        {permissions.map((p) => (
          <label className="check" key={p.id} style={{ opacity: p.grantable ? 1 : 0.5 }} title={p.grantable ? undefined : "You don't have this permission yourself"}>
            <input
              type="checkbox"
              disabled={!p.grantable}
              checked={picked.includes(p.id)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))}
            />
            {p.label}
          </label>
        ))}
      </fieldset>
      {error && <div className="notice error">{error}</div>}
      <button className="primary big" type="submit" disabled={busy || picked.length === 0}>
        <Check size={22} aria-hidden /> {busy ? 'Saving…' : role ? 'Save role' : 'Create role'}
      </button>
    </form>
  );
}
