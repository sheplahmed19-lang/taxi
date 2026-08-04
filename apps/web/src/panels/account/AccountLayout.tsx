import { createContext, useContext } from "react";
import { HistoryOutlined, UserOutlined, WalletOutlined } from "@ant-design/icons";
import { useLocation } from "react-router-dom";
import { AppShell } from "../../shared/AppShell";

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
  const location = useLocation();

  const menuItems = [
    { key: `${basePath}`, icon: <HistoryOutlined />, label: "Ride history" },
    { key: `${basePath}/wallet`, icon: <WalletOutlined />, label: "Wallet" },
    { key: `${basePath}/profile`, icon: <UserOutlined />, label: "Profile" },
  ];

  const selectedKey = menuItems.find((item) => item.key === location.pathname)?.key ?? basePath;

  return (
    <AccountBasePathContext.Provider value={basePath}>
      <AppShell panelLabel={title} menuItems={menuItems} selectedKey={selectedKey} />
    </AccountBasePathContext.Provider>
  );
}
