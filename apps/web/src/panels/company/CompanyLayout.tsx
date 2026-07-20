import { LogoutOutlined } from "@ant-design/icons";
import { Avatar, Dropdown, Layout, Space, Typography } from "antd";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../shared/AuthProvider";

const { Header, Content } = Layout;

/**
 * Scope decision (Phase 4.4): the company (fleet_owner) panel is a
 * read-only "my fleet" view, not a full operational panel like the
 * dispatcher's — a fleet owner sees only their own vehicles/drivers, no
 * platform financial controls (payouts, owe, broadcasts stay
 * dispatcher/admin-only). One page today; a sidebar can grow here later if
 * the fleet_owner role gains more scoped actions.
 */
export function CompanyLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header
        style={{
          background: "#fff",
          padding: "0 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography.Text strong>Company Panel</Typography.Text>
        <Dropdown
          menu={{
            items: [{ key: "logout", icon: <LogoutOutlined />, label: "Sign out", onClick: handleLogout }],
          }}
        >
          <Space style={{ cursor: "pointer" }}>
            <Avatar size="small">{user?.email?.[0]?.toUpperCase()}</Avatar>
            <span>{user?.email}</span>
          </Space>
        </Dropdown>
      </Header>
      <Content style={{ margin: 16 }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
