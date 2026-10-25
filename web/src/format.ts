/** Minutes since an ISO time, never negative. */
export function minutesSince(iso: string, now = Date.now()): number {
  return Math.max(0, (now - Date.parse(iso)) / 60_000);
}

/** "Just now", "45m", "2h 10m". */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string): string {
  const mins = minutesSince(iso);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatRupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/**
 * Shows only the last 4 digits in staff lists (NFR-PRIV-01). The server already masks the number
 * for staff without guest.view_full_mobile; this also hides it on shared screens for those with it.
 */
export function maskMobile(mobile: string | null): string {
  if (!mobile) return '—';
  const digits = mobile.replace(/\D/g, '');
  return digits.length < 4 ? mobile : `••••••${digits.slice(-4)}`;
}

/** True when the number is complete (not masked by the server), so it can be dialled. */
export function isDiallable(mobile: string | null): mobile is string {
  return Boolean(mobile && /^\+?[0-9 ]{6,16}$/.test(mobile));
}
