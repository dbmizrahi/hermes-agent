// Base HTTP client for the Hermes Agent API (port 8642)
// Returns raw JSON responses (no {status, data} wrapper).
// Handles auth interceptors and token refresh on 401.

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export function getBaseUrl(): string {
  return API_BASE.startsWith('http') ? API_BASE : '';
}

export function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  if (API_BASE.startsWith('http')) {
    const url = new URL(`${API_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token management (localStorage)
// ---------------------------------------------------------------------------

const ACCESS_KEY = 'hermes_access_token';
const REFRESH_KEY = 'hermes_refresh_token';

export function getToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

interface FetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

let refreshing = false;
let refreshQueue: Array<() => void> = [];

async function attemptRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;

  try {
    const res = await fetch(buildUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.access_token && data.refresh_token) {
      setTokens(data.access_token, data.refresh_token);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function authFetch(path: string, options: FetchOptions = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res = await fetch(buildUrl(path), {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  // On 401, attempt a single token refresh then retry
  if (res.status === 401 && token) {
    if (refreshing) {
      // Another refresh is in flight — wait for it
      await new Promise<void>((resolve) => refreshQueue.push(resolve));
      // Retry with the new token
      const newToken = getToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        res = await fetch(buildUrl(path), {
          method: options.method || 'GET',
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: options.signal,
        });
      }
    } else {
      refreshing = true;
      const ok = await attemptRefresh();
      refreshing = false;
      const queue = refreshQueue;
      refreshQueue = [];
      queue.forEach((fn) => fn());

      if (ok) {
        const newToken = getToken();
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
        }
        res = await fetch(buildUrl(path), {
          method: options.method || 'GET',
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: options.signal,
        });
      } else {
        // Refresh failed — clear tokens and redirect to login
        clearTokens();
        window.location.href = '/login';
      }
    }
  }

  return res;
}

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

export async function apiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const res = await authFetch(path, { method: 'GET' });
  return parseResponse<T>(res, params);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await authFetch(path, { method: 'POST', body });
  return parseResponse<T>(res);
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await authFetch(path, { method: 'PUT', body });
  return parseResponse<T>(res);
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await authFetch(path, { method: 'PATCH', body });
  return parseResponse<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T | void> {
  const res = await authFetch(path, { method: 'DELETE' });
  if (res.status === 204) return;
  return parseResponse<T>(res);
}

async function parseResponse<T>(res: Response, _params?: unknown): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error?.message || data.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Paginated response adapter
// Converts Hermes {limit, offset, total} → frontend {page, page_size, total_pages}
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export function adaptPagination<T>(
  raw: { items?: T[]; total: number; limit: number; offset: number },
  itemKey: string = 'items',
): PaginatedResult<T> {
  const items = (raw as Record<string, T[]>)[itemKey] || (raw.items as unknown as T[]) || [];
  const limit = raw.limit || 20;
  const offset = raw.offset || 0;
  const total = raw.total || 0;
  return {
    items,
    total,
    page: Math.floor(offset / limit) + 1,
    page_size: limit,
    total_pages: Math.ceil(total / limit),
  };
}
