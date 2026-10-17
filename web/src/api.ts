const TOKEN_KEY = 'valet.token';

/**
 * Address of the Valet server. Empty when the web app is served by the server itself; set
 * VITE_API_BASE (e.g. https://valet-parking.onrender.com) when the web app is hosted elsewhere,
 * such as GitHub Pages.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

/** Preview build without a server (GitHub Pages): the screens load, but nothing can be saved. */
export const IS_PREVIEW_WITHOUT_SERVER = import.meta.env.VITE_PREVIEW === 'true' && API_BASE === '';

/** Turns a server path such as /api/files?... into a full address. */
export function apiUrl(path: string): string {
  return path.startsWith('/') ? `${API_BASE}${path}` : path;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode); the session lasts until reload.
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  if (IS_PREVIEW_WITHOUT_SERVER) {
    throw new ApiError(503, 'This GitHub Pages preview has no Valet server behind it, so it cannot sign in or save data.');
  }
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = options.auth === false ? null : getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    if (res.status === 401 && options.auth !== false) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  }
  return data as T;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
