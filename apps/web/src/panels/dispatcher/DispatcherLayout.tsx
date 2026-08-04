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
} from "@ant-design/icons";
import { useLocation } from "react-router-dom";
import { AppShell } from "../../shared/AppShell";

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
  const location = useLocation();

  const selectedKey =
    MENU_ITEMS.find((item) => location.pathname === item.key)?.key ??
    (location.pathname.startsWith("/dispatcher/trips") ? "/dispatcher/trips" : "/dispatcher");

  return <AppShell panelLabel="Dispatcher" menuItems={MENU_ITEMS} selectedKey={selectedKey} />;
}
