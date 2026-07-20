import {
  DashboardOutlined,
  EnvironmentOutlined,
  CarOutlined,
  UnorderedListOutlined,
  DollarOutlined,
  WarningOutlined,
  FileTextOutlined,
  BarChartOutlined,
  NotificationOutlined,
  BorderOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { Avatar, Dropdown, Layout, Menu, Space, Typography } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../shared/AuthProvider";

const { Header, Sider, Content } = Layout;

const MENU_ITEMS = [
  { key: "/dispatcher", icon: <DashboardOutlined />, label: "Dashboard" },
  { key: "/dispatcher/live", icon: <EnvironmentOutlined />, label: "Live ops" },
  { key: "/dispatcher/book", icon: <CarOutlined />, label: "Manual booking" },
  { key: "/dispatcher/trips", icon: <UnorderedListOutlined />, label: "Trips" },
  { key: "/dispatcher/payouts", icon: <DollarOutlined />, label: "Payouts" },
  { key: "/dispatcher/owe", icon: <WarningOutlined />, label: "Owe" },
  { key: "/dispatcher/statements", icon: <FileTextOutlined />, label: "Statements" },
  { key: "/dispatcher/reports", icon: <BarChartOutlined />, label: "Reports" },
  { key: "/dispatcher/broadcast", icon: <NotificationOutlined />, label: "Broadcast" },
  { key: "/dispatcher/zones", icon: <BorderOutlined />, label: "Zones" },
];

export function DispatcherLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const selectedKey =
    MENU_ITEMS.find((item) => location.pathname === item.key)?.key ??
    (location.pathname.startsWith("/dispatcher/trips") ? "/dispatcher/trips" : "/dispatcher");

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
          <Typography.Text strong>Dispatcher Panel</Typography.Text>
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
