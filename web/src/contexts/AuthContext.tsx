import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, revoke, getToken, isAuthenticated } from '@/api/auth';

interface AuthUser {
  apiKey: string;
}

interface AuthContextType {
  user: AuthUser | null;
  login: (apiKey: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // On mount, check if we already have a token
  useEffect(() => {
    const token = getToken();
    if (token) {
      // Token exists — user is considered authenticated
      // We don't validate it here; let API 401s handle invalid tokens
      setUser({ apiKey: '[stored]' });
    }
    setIsAuthLoading(false);
  }, []);

  const login = useCallback(async (apiKey: string) => {
    await apiLogin(apiKey);
    setUser({ apiKey });
  }, []);

  const logout = useCallback(async () => {
    try {
      await revoke();
    } catch {
      // Ignore revoke errors
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
