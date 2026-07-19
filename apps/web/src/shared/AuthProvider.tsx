import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { apiClient } from "./apiClient";
import { clearSession, loadSession, saveSession, type Session, type StaffUser } from "./auth";

interface AuthContextValue {
  user: StaffUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<StaffUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post("/auth/staff/login", { email, password });
    const { user, accessToken, refreshToken } = response.data.data as Session;
    const next: Session = { user, accessToken, refreshToken };
    saveSession(next);
    setSession(next);
    return user;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      isAuthenticated: session !== null,
      login,
      logout,
    }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return ctx;
}
