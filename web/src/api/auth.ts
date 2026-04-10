// Auth service — login, refresh, revoke, token management
import { apiPost, setTokens, clearTokens, getToken, isAuthenticated } from './client';

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export async function login(apiKey: string): Promise<AuthTokens> {
  const result = await apiPost<AuthTokens>('/api/auth/token', { api_key: apiKey });
  if (result.access_token && result.refresh_token) {
    setTokens(result.access_token, result.refresh_token);
  }
  return result;
}

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const result = await apiPost<AuthTokens>('/api/auth/refresh', { refresh_token: refreshToken });
  if (result.access_token && result.refresh_token) {
    setTokens(result.access_token, result.refresh_token);
  }
  return result;
}

export async function revoke(): Promise<void> {
  const refreshToken = localStorage.getItem('hermes_refresh_token');
  if (refreshToken) {
    try {
      await apiPost('/api/auth/revoke', { refresh_token: refreshToken });
    } catch {
      // Ignore errors on revoke — just clear local state
    }
  }
  clearTokens();
}

export { getToken, clearTokens, isAuthenticated };
