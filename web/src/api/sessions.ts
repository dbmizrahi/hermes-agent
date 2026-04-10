// Sessions API service
import { apiGet, apiPost, apiPatch, apiDelete, adaptPagination, PaginatedResult } from './client';

export interface HermesSession {
  id: string;
  source: string;
  model?: string;
  title?: string;
  started_at?: number;
  ended_at?: number;
  message_count?: number;
  tool_call_count?: number;
  estimated_cost_usd?: number;
}

export interface SessionListResponse {
  sessions: HermesSession[];
  total: number;
  limit: number;
  offset: number;
}

export interface SessionDetail {
  session: HermesSession;
  messages: Array<{ role: string; content: string; [key: string]: unknown }>;
}

export interface CreateSessionParams {
  session_id?: string;
  title?: string;
  model?: string;
  source?: string;
}

export async function listSessions(params?: { limit?: number; offset?: number; source?: string }): Promise<PaginatedResult<HermesSession>> {
  const raw = await apiGet<SessionListResponse>('/api/sessions', {
    limit: params?.limit ?? 20,
    offset: params?.offset ?? 0,
    source: params?.source,
  });
  return adaptPagination(raw, 'sessions');
}

export async function searchSessions(q: string, params?: { limit?: number; source?: string }) {
  return apiGet<{ results: unknown[]; total: number }>('/api/sessions/search', {
    q,
    limit: params?.limit ?? 10,
    source: params?.source,
  });
}

export async function getSession(id: string): Promise<SessionDetail> {
  return apiGet<SessionDetail>(`/api/sessions/${id}`);
}

export async function createSession(params?: CreateSessionParams): Promise<{ session: HermesSession; session_id: string }> {
  return apiPost('/api/sessions', params || {});
}

export async function renameSession(id: string, title: string): Promise<{ session: HermesSession }> {
  return apiPatch(`/api/sessions/${id}`, { title });
}

export async function deleteSession(id: string): Promise<void> {
  return apiDelete(`/api/sessions/${id}`);
}

export async function exportSession(id: string): Promise<string> {
  const url = `${import.meta.env.VITE_API_BASE || ''}/api/sessions/${id}/export`;
  const token = localStorage.getItem('hermes_access_token');
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Export failed');
  return res.text();
}
