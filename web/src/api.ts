const TOKEN_KEY = 'valet.token';

/**
 * Address of the Valet server. Empty when the web app is served by the server itself; set
 * VITE_API_BASE (e.g. https://valetpay.onrender.com) when the web app is hosted elsewhere,
 * such as GitHub Pages.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

/**
 * GitHub Pages build without a server address: the Valet server runs inside the browser
 * (demo/demoServer.ts), with data kept on this device only.
 */
export const IS_BROWSER_DEMO = import.meta.env.VITE_PREVIEW === 'true' && API_BASE === '';

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
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const token = options.auth === false ? null : getToken();
  let status: number;
  let data: { error?: string; code?: string };

  if (IS_BROWSER_DEMO) {
    // Same routes as the real server, running in this browser (loaded only in the Pages demo build).
    const { demoRequest } = await import('./demo/demoServer');
    const res = await demoRequest(method, path, options.body, token);
    status = res.status;
    data = structuredClone(res.body) as typeof data;
  } else {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    } catch {
      // fetch only rejects when the request never reached the server: no signal, Wi-Fi dropped, DNS.
      throw new ApiError(0, NETWORK_MESSAGE, 'NETWORK');
    }
    status = res.status;
    data = (await res.json().catch(() => ({}))) as typeof data;
  }

  if (status >= 400) {
    if (status === 401 && options.auth !== false) onUnauthorized?.();
    if (!data.error && (status === 502 || status === 503 || status === 504)) throw new ApiError(status, SERVER_WAKING_MESSAGE, 'UNAVAILABLE');
    throw new ApiError(status, data.error ?? `Request failed (${status})`, data.code);
  }
  return data as T;
}

export const NETWORK_MESSAGE = 'No internet connection. Nothing you entered is lost: move to where there is signal and try again.';
/** Render's free plan sleeps when idle and answers 502/503 while it wakes up. */
const SERVER_WAKING_MESSAGE = 'The server is starting up or busy. Wait a few seconds and try again.';

export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'NETWORK';
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
