import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { panelPathForRole, type StaffRole } from "./auth";

interface ProtectedRouteProps {
  allowedRoles: StaffRole[];
}

/** Gates a route subtree: bounces unauthenticated users to /login, and authenticated-but-wrong-role users to their own panel. */
export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={panelPathForRole(user.role)} replace />;
  }

  return <Outlet />;
}
