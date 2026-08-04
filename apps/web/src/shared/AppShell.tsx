import type { ReactNode } from "react";
import { CarOutlined, LogoutOutlined } from "@ant-design/icons";
import { Avatar, Dropdown, Layout, Menu, Space, Typography, type MenuProps } from "antd";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { brand } from "./theme";

const { Header, Sider, Content } = Layout;

interface AppShellProps {
  /** e.g. "Admin", "Dispatcher", "Company", "Rider", "Driver" — shown in the header and as the sidebar subtitle. */
  panelLabel: string;
  menuItems: NonNullable<MenuProps["items"]>;
  selectedKey: string;
  /** Falls back to the authenticated user's email or phone when omitted. */
  identityLabel?: string;
  /** Renders in place of <Outlet/> — only used by pages that need extra layout control. Most panels omit this. */
  children?: ReactNode;
}

/**
 * Shared branded shell for every panel — admin/dispatcher/company/rider/
 * driver all render structurally identical Sider+Header+Content layouts, so
 * this is the one place that owns how that looks. Previously each layout
 * hand-rolled its own (near-identical, slowly-diverging) copy.
 */
export function AppShell({ panelLabel, menuItems, selectedKey, identityLabel, children }: AppShellProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const identity = identityLabel ?? user?.email ?? user?.phone ?? "";
  const initial = identity ? identity.replace(/^\+/, "")[0]?.toUpperCase() : "?";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth="0" width={232} style={{ background: brand.sidebarBg }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "20px 20px 16px",
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: `linear-gradient(135deg, ${brand.primary}, ${brand.accent})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
            }}
          >
            <CarOutlined style={{ color: "#fff", fontSize: 17 }} />
          </div>
          <div style={{ lineHeight: 1.15, overflow: "hidden" }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>Ride Platform</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{panelLabel}</div>
          </div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ background: "transparent", border: "none", padding: "4px 0" }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: "0 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid #EEF0F5",
            boxShadow: "0 1px 2px rgba(16, 24, 40, 0.03)",
          }}
        >
          <Typography.Title level={5} style={{ margin: 0 }}>
            {panelLabel}
          </Typography.Title>
          <Dropdown
            menu={{
              items: [{ key: "logout", icon: <LogoutOutlined />, label: "Sign out", onClick: handleLogout }],
            }}
            trigger={["click"]}
          >
            <Space style={{ cursor: "pointer" }} size={10}>
              <Avatar size={30} style={{ background: brand.primary, fontWeight: 600 }}>
                {initial}
              </Avatar>
              <span style={{ color: "#344054", fontSize: 14 }}>{identity}</span>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: 20 }}>{children ?? <Outlet />}</Content>
      </Layout>
    </Layout>
  );
}
