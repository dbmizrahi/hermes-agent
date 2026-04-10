// Cron jobs API service
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export interface ScheduleInfo {
  kind: string;
  expr: string;
  display: string;
}

export interface HermesJob {
  id: string;
  name?: string;
  prompt?: string;
  schedule?: string | ScheduleInfo;
  skill?: string;
  skills?: string[];
  deliver?: string;
  model?: string;
  repeat?: number;
  enabled?: boolean;
  created_at?: string;
}

export async function listJobs(includeDisabled?: boolean): Promise<{ jobs: HermesJob[] }> {
  return apiGet('/api/jobs', { include_disabled: includeDisabled });
}

export async function getJob(id: string): Promise<HermesJob> {
  return apiGet(`/api/jobs/${id}`);
}

export async function createJob(params: { name?: string; schedule: string; prompt?: string; deliver?: string }): Promise<HermesJob> {
  return apiPost('/api/jobs', params);
}

export async function updateJob(id: string, params: Partial<HermesJob>): Promise<HermesJob> {
  return apiPatch(`/api/jobs/${id}`, params);
}

export async function deleteJob(id: string): Promise<void> {
  return apiDelete(`/api/jobs/${id}`);
}

export async function pauseJob(id: string): Promise<void> {
  return apiPost(`/api/jobs/${id}/pause`, {});
}

export async function resumeJob(id: string): Promise<void> {
  return apiPost(`/api/jobs/${id}/resume`, {});
}

export async function runJob(id: string): Promise<void> {
  return apiPost(`/api/jobs/${id}/run`, {});
}

export async function getJobOutput(): Promise<{ outputs: unknown[] }> {
  return apiGet('/api/jobs/output');
}

export async function getJobHistory(id: string): Promise<{ history: unknown[] }> {
  return apiGet(`/api/jobs/${id}/history`);
}
