// Memory API service
import { apiGet, apiPatch, apiDelete } from './client';

export interface MemoryStoreInfo {
  entries?: Array<{ text: string; timestamp?: number }>;
  char_count?: number;
  char_limit?: number;
  usage_pct?: number;
}

export interface MemoryResponse {
  memory: MemoryStoreInfo;
  user: MemoryStoreInfo;
}

export interface MemoryPatchResult {
  success: boolean;
  target: string;
  entries?: Array<{ text: string }>;
  char_count?: number;
  char_limit?: number;
  usage_pct?: number;
}

export async function getMemory(): Promise<MemoryResponse> {
  return apiGet<MemoryResponse>('/api/memory');
}

export async function addMemory(target: 'memory' | 'user', content: string): Promise<MemoryPatchResult> {
  return apiPatch<MemoryPatchResult>('/api/memory', { target, action: 'add', content });
}

export async function replaceMemory(target: 'memory' | 'user', oldText: string, content: string): Promise<MemoryPatchResult> {
  return apiPatch<MemoryPatchResult>('/api/memory', { target, action: 'replace', content, old_text: oldText });
}

export async function removeMemory(target: 'memory' | 'user', oldText: string): Promise<MemoryPatchResult> {
  return apiPatch<MemoryPatchResult>('/api/memory', { target, action: 'remove', old_text: oldText });
}

export async function deleteMemoryEntry(target: 'memory' | 'user', oldText: string): Promise<MemoryPatchResult> {
  return apiDelete<MemoryPatchResult>('/api/memory/entry') as Promise<MemoryPatchResult>;
}
