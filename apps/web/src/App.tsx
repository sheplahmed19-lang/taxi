import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminLayout } from "./panels/admin/AdminLayout";
import { AdminDashboard } from "./panels/admin/AdminDashboard";
import { DriversPage } from "./panels/admin/DriversPage";
import { UsersPage } from "./panels/admin/UsersPage";
import { VehiclesPage } from "./panels/admin/VehiclesPage";
import { ConfigPage } from "./panels/admin/ConfigPage";
import { RolesPage } from "./panels/admin/RolesPage";
import { LiveOpsPage } from "./panels/admin/LiveOpsPage";
import { TripDetailPage } from "./panels/admin/TripDetailPage";
import { DispatcherLayout } from "./panels/dispatcher/DispatcherLayout";
import { ManualBookingPage } from "./panels/dispatcher/ManualBookingPage";
import { TripManagementPage } from "./panels/dispatcher/TripManagementPage";
import { PayoutsPage } from "./panels/dispatcher/PayoutsPage";
import { OwePage } from "./panels/dispatcher/OwePage";
import { StatementsPage } from "./panels/dispatcher/StatementsPage";
import { ReportsPage } from "./panels/dispatcher/ReportsPage";
import { BroadcastComposerPage } from "./panels/dispatcher/BroadcastComposerPage";
import { ZonesPage } from "./panels/dispatcher/ZonesPage";
import { CompanyLayout } from "./panels/company/CompanyLayout";
import { CompanyFleetPage } from "./panels/company/CompanyFleetPage";
import { LoginPage } from "./shared/LoginPage";
import { AuthProvider, useAuth } from "./shared/AuthProvider";
import { ProtectedRoute } from "./shared/ProtectedRoute";
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
                <Route path="drivers" element={<DriversPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="vehicles" element={<VehiclesPage />} />
                <Route path="config" element={<ConfigPage />} />
                <Route path="roles" element={<RolesPage />} />
                <Route path="live" element={<LiveOpsPage />} />
                <Route path="trips/:id" element={<TripDetailPage />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute allowedRoles={["fleet_owner"]} />}>
              <Route path="/company" element={<CompanyLayout />}>
                <Route index element={<CompanyFleetPage />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute allowedRoles={["dispatcher"]} />}>
              <Route path="/dispatcher" element={<DispatcherLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="live" element={<LiveOpsPage basePath="/dispatcher" />} />
                <Route path="book" element={<ManualBookingPage />} />
                <Route path="trips" element={<TripManagementPage />} />
                <Route path="trips/:id" element={<TripDetailPage />} />
                <Route path="payouts" element={<PayoutsPage />} />
                <Route path="owe" element={<OwePage />} />
                <Route path="statements" element={<StatementsPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="broadcast" element={<BroadcastComposerPage />} />
                <Route path="zones" element={<ZonesPage />} />
              </Route>
            </Route>

            <Route path="/" element={<RootRedirect />} />
            <Route path="*" element={<RootRedirect />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
