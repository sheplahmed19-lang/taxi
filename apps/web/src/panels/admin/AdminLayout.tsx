import { DashboardOutlined, CarOutlined, TeamOutlined, SettingOutlined } from "@ant-design/icons";
import { Layout, Menu } from "antd";
import { Outlet } from "react-router-dom";

const { Header, Sider, Content } = Layout;

export function AdminLayout() {
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div style={{ color: "#fff", padding: 16, fontWeight: 700 }}>Ride Platform</div>
        <Menu
          theme="dark"
          mode="inline"
          defaultSelectedKeys={["dashboard"]}
          items={[
            { key: "dashboard", icon: <DashboardOutlined />, label: "Dashboard" },
            { key: "drivers", icon: <CarOutlined />, label: "Drivers" },
            { key: "users", icon: <TeamOutlined />, label: "Users" },
            { key: "config", icon: <SettingOutlined />, label: "Config" },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ background: "#fff", padding: "0 16px" }}>Admin Panel</Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
