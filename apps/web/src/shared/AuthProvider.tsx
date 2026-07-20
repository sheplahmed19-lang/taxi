import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { apiClient } from "./apiClient";
import { clearSession, loadSession, saveSession, type Session, type StaffUser, type UserRole } from "./auth";

interface AuthContextValue {
  user: StaffUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<StaffUser>;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, otp: string, role: "rider" | "driver") => Promise<StaffUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post("/auth/staff/login", { email, password });
    const raw = response.data.data as { user: { id: string; email: string | null; role: UserRole }; accessToken: string; refreshToken: string };
    const user: StaffUser = { ...raw.user, phone: null };
    const next: Session = { user, accessToken: raw.accessToken, refreshToken: raw.refreshToken };
    saveSession(next);
    setSession(next);
    return user;
  }, []);

  const requestOtp = useCallback(async (phone: string) => {
    await apiClient.post("/auth/otp/request", { phone });
  }, []);

  const verifyOtp = useCallback(async (phone: string, otp: string, role: "rider" | "driver") => {
    const response = await apiClient.post("/auth/otp/verify", { phone, otp, role });
    const raw = response.data.data as { user: { id: string; phone: string | null; role: UserRole }; accessToken: string; refreshToken: string };
    const user: StaffUser = { ...raw.user, email: null };
    const next: Session = { user, accessToken: raw.accessToken, refreshToken: raw.refreshToken };
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
      requestOtp,
      verifyOtp,
      logout,
    }),
    [session, login, requestOtp, verifyOtp, logout],
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
