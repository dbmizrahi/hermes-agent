// Production (Docker): empty VITE_API_BASE means relative paths with /api/ prefix
// Dev mode: VITE_API_BASE=http://localhost:8082 connects directly to API server
const PROD_API_PREFIX = '/api';

export const API_BASE = import.meta.env.VITE_API_BASE || PROD_API_PREFIX;

export const WS_BASE = API_BASE.startsWith('http')
  ? API_BASE.replace(/^http/, 'ws')
  : (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host;

function buildUrl(path: string, params?: Record<string, string | number>): string {
  if (API_BASE.startsWith('http')) {
    const url = new URL(`${API_BASE}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    }
    return url.toString();
  }
  // Production: relative URL
  const url = new URL(path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }
  return url.toString();
}

interface ApiResponse<T> {
  status: 'ok' | 'error';
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export type PaginatedResponse<T> = ApiResponse<PaginatedData<T>>;

export async function apiGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const res = await fetch(buildUrl(path, params));
  const json: ApiResponse<T> = await res.json();
  if (json.status === 'error') throw new Error(json.error?.message || 'API Error');
  return json.data as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: ApiResponse<T> = await res.json();
  if (json.status === 'error') throw new Error(json.error?.message || 'API Error');
  return json.data as T;
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: ApiResponse<T> = await res.json();
  if (json.status === 'error') throw new Error(json.error?.message || 'API Error');
  return json.data as T;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: ApiResponse<T> = await res.json();
  if (json.status === 'error') throw new Error(json.error?.message || 'API Error');
  return json.data as T;
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: ApiResponse<T> = await res.json();
  if (json.status === 'error') throw new Error(json.error?.message || 'API Error');
  return json.data as T;
}
