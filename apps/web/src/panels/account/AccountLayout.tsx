import { createContext, useContext } from "react";
import { CarOutlined, HistoryOutlined, LogoutOutlined, UserOutlined, WalletOutlined } from "@ant-design/icons";
import { Avatar, Dropdown, Layout, Menu, Space, Typography } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../shared/AuthProvider";

const { Header, Sider, Content } = Layout;

const AccountBasePathContext = createContext("/rider");

export function useAccountBasePath(): string {
  return useContext(AccountBasePathContext);
}

interface AccountLayoutProps {
  title: string;
  basePath: "/rider" | "/driver";
}

/**
 * Shared shell for both the rider and driver web panels (Phase 4.5 —
 * intentionally thin: history, receipts, wallet, profile). Mounted twice in
 * App.tsx under /rider and /driver so the four page components below are
 * written once and never need to know which role is viewing them.
 */
export function AccountLayout({ title, basePath }: AccountLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const menuItems = [
    { key: `${basePath}`, icon: <HistoryOutlined />, label: "Ride history" },
    { key: `${basePath}/wallet`, icon: <WalletOutlined />, label: "Wallet" },
    { key: `${basePath}/profile`, icon: <UserOutlined />, label: "Profile" },
  ];

  const selectedKey = menuItems.find((item) => item.key === location.pathname)?.key ?? basePath;

  return (
    <AccountBasePathContext.Provider value={basePath}>
      <Layout style={{ minHeight: "100vh" }}>
        <Sider breakpoint="lg" collapsedWidth="0">
          <div style={{ color: "#fff", padding: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <CarOutlined /> {title}
          </div>
          <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} items={menuItems} onClick={({ key }) => navigate(key)} />
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
            <Typography.Text strong>{title}</Typography.Text>
            <Dropdown menu={{ items: [{ key: "logout", icon: <LogoutOutlined />, label: "Sign out", onClick: handleLogout }] }}>
              <Space style={{ cursor: "pointer" }}>
                <Avatar size="small" icon={<UserOutlined />} />
                <span>{user?.phone}</span>
              </Space>
            </Dropdown>
          </Header>
          <Content style={{ margin: 16 }}>
            <Outlet />
          </Content>
        </Layout>
      </Layout>
    </AccountBasePathContext.Provider>
  );
}
