import { Button, Layout, Result, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

interface PlaceholderPanelProps {
  title: string;
  phase: string;
}

/** Company (fleet_owner) and dispatcher panels: real login + routing land here in 4.1, the panels themselves in Phase 4.4. */
export function PlaceholderPanel({ title, phase }: PlaceholderPanelProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Content style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Result
          status="info"
          title={title}
          subTitle={
            <>
              Signed in as <Typography.Text strong>{user?.email}</Typography.Text> ({user?.role}). This panel is
              built out in {phase}.
            </>
          }
          extra={
            <Button type="primary" onClick={handleLogout}>
              Sign out
            </Button>
          }
        />
      </Layout.Content>
    </Layout>
  );
}
