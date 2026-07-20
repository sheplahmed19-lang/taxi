import {
  DashboardOutlined,
  CarOutlined,
  TeamOutlined,
  SettingOutlined,
  LogoutOutlined,
  CarryOutOutlined,
  SafetyCertificateOutlined,
  EnvironmentOutlined,
} from "@ant-design/icons";
import { Avatar, Dropdown, Layout, Menu, Space, Typography } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../shared/AuthProvider";

const { Header, Sider, Content } = Layout;

const MENU_ITEMS = [
  { key: "/admin", icon: <DashboardOutlined />, label: "Dashboard" },
  { key: "/admin/live", icon: <EnvironmentOutlined />, label: "Live ops" },
  { key: "/admin/drivers", icon: <CarOutlined />, label: "Drivers" },
  { key: "/admin/users", icon: <TeamOutlined />, label: "Users" },
  { key: "/admin/vehicles", icon: <CarryOutOutlined />, label: "Vehicles" },
  { key: "/admin/config", icon: <SettingOutlined />, label: "Config" },
  { key: "/admin/roles", icon: <SafetyCertificateOutlined />, label: "Roles" },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const selectedKey =
    MENU_ITEMS.find((item) => location.pathname === item.key)?.key ??
    (location.pathname.startsWith("/admin/trips") ? "/admin/live" : "/admin");

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div style={{ color: "#fff", padding: 16, fontWeight: 700 }}>Ride Platform</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: "0 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography.Text strong>Admin Panel</Typography.Text>
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
    </Layout>
  );
}
