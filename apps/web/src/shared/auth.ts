export type StaffRole = "admin" | "staff" | "fleet_owner" | "dispatcher";

export interface StaffUser {
  id: string;
  email: string | null;
  role: StaffRole;
}

export interface Session {
  user: StaffUser;
  accessToken: string;
  refreshToken: string;
}

const STORAGE_KEY = "ride_platform_session";

export function loadSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Where a given staff role lands after login — panels beyond /admin are placeholders until Phase 4.4. */
export function panelPathForRole(role: StaffRole): string {
  switch (role) {
    case "fleet_owner":
      return "/company";
    case "dispatcher":
      return "/dispatcher";
    default:
      return "/admin";
  }
}
