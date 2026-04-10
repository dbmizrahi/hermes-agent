// Gateway API service
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export interface HermesPlatform {
  name: string;
  type: string;
  connected?: boolean;
  config?: Record<string, unknown>;
}

export async function getGatewayStatus(): Promise<{ status: string; platform?: string; uptime_seconds?: number; version?: string; model?: string; active_sessions?: number; platforms?: string[] }> {
  return apiGet('/api/gateway/status');
}

export async function listPlatforms(): Promise<{ platforms: HermesPlatform[] }> {
  return apiGet('/api/gateway/platforms');
}

export async function addPlatform(params: { name: string; type: string; config?: Record<string, unknown> }): Promise<HermesPlatform> {
  return apiPost('/api/gateway/platforms', params);
}

export async function connectPlatform(name: string): Promise<void> {
  return apiPost(`/api/gateway/platforms/${name}/connect`, {});
}

export async function disconnectPlatform(name: string): Promise<void> {
  return apiPost(`/api/gateway/platforms/${name}/disconnect`, {});
}

export async function updatePlatform(name: string, params: Record<string, unknown>): Promise<HermesPlatform> {
  return apiPatch(`/api/gateway/platforms/${name}`, params);
}

export async function removePlatform(name: string): Promise<void> {
  return apiDelete(`/api/gateway/platforms/${name}`);
}
