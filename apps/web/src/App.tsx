import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./panels/admin/AdminLayout";
import { AdminDashboard } from "./panels/admin/AdminDashboard";
import { LoginPage } from "./shared/LoginPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
        </Route>
        {/* /company and /dispatcher panels land in Phase 4.4 */}
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
