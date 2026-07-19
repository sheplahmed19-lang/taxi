import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminLayout } from "./panels/admin/AdminLayout";
import { AdminDashboard } from "./panels/admin/AdminDashboard";
import { LoginPage } from "./shared/LoginPage";
import { AuthProvider, useAuth } from "./shared/AuthProvider";
import { ProtectedRoute } from "./shared/ProtectedRoute";
import { ComingSoon } from "./shared/ComingSoon";
import { PlaceholderPanel } from "./shared/PlaceholderPanel";
import { panelPathForRole } from "./shared/auth";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/** Sends an already-authenticated visitor straight to their panel instead of the login form. */
function RootRedirect() {
  const { user, isAuthenticated } = useAuth();
  return <Navigate to={isAuthenticated && user ? panelPathForRole(user.role) : "/login"} replace />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<ProtectedRoute allowedRoles={["admin", "staff"]} />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="drivers" element={<ComingSoon phase="Phase 4.2 — Admin core" />} />
                <Route path="users" element={<ComingSoon phase="Phase 4.2 — Admin core" />} />
                <Route path="config" element={<ComingSoon phase="Phase 4.2 — Admin core" />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute allowedRoles={["fleet_owner"]} />}>
              <Route path="/company" element={<PlaceholderPanel title="Company panel" phase="Phase 4.4 — Dispatcher/company panel" />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={["dispatcher"]} />}>
              <Route path="/dispatcher" element={<PlaceholderPanel title="Dispatcher panel" phase="Phase 4.4 — Dispatcher/company panel" />} />
            </Route>

            <Route path="/" element={<RootRedirect />} />
            <Route path="*" element={<RootRedirect />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
