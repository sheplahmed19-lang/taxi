export type UserRole = "admin" | "staff" | "fleet_owner" | "dispatcher" | "rider" | "driver";

export interface StaffUser {
  id: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
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

/** Where a given user role lands after login. */
export function panelPathForRole(role: UserRole): string {
  switch (role) {
    case "fleet_owner":
      return "/company";
    case "dispatcher":
      return "/dispatcher";
    case "rider":
      return "/rider";
    case "driver":
      return "/driver";
    default:
      return "/admin";
  }
}
