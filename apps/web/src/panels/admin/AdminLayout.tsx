import {
  DashboardOutlined,
  CarOutlined,
  TeamOutlined,
  SettingOutlined,
  CarryOutOutlined,
  SafetyCertificateOutlined,
  EnvironmentOutlined,
} from "@ant-design/icons";
import { useLocation } from "react-router-dom";
import { AppShell } from "../../shared/AppShell";

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
  const location = useLocation();

  const selectedKey =
    MENU_ITEMS.find((item) => location.pathname === item.key)?.key ??
    (location.pathname.startsWith("/admin/trips") ? "/admin/live" : "/admin");

  return <AppShell panelLabel="Admin" menuItems={MENU_ITEMS} selectedKey={selectedKey} />;
}
