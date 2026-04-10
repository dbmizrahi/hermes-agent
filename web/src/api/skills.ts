// Skills API service
import { apiGet, apiPost, apiDelete } from './client';

export interface HermesSkill {
  name: string;
  description: string;
  version?: string;
  author?: string;
  category?: string;
  updated_at?: number;
}

export async function listSkills(category?: string): Promise<{ skills: HermesSkill[]; total: number }> {
  return apiGet('/api/skills', category ? { category } : {});
}

export async function getSkill(name: string): Promise<HermesSkill & { content?: string }> {
  return apiGet(`/api/skills/${name}`);
}

export async function installSkill(name: string): Promise<{ success: boolean; message?: string }> {
  return apiPost('/api/skills/install', { name });
}

export async function checkSkillUpdates(): Promise<{ updates_available: boolean }> {
  return apiPost('/api/skills/check', {});
}

export async function updateSkills(): Promise<{ updated: number }> {
  return apiPost('/api/skills/update', {});
}

export async function deleteSkill(name: string): Promise<void> {
  return apiDelete(`/api/skills/${name}`);
}
