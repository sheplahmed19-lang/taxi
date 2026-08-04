import { CarOutlined } from "@ant-design/icons";
import { AppShell } from "../../shared/AppShell";

const MENU_ITEMS = [{ key: "/company", icon: <CarOutlined />, label: "My fleet" }];

/**
 * Scope decision (Phase 4.4): the company (fleet_owner) panel is a
 * read-only "my fleet" view, not a full operational panel like the
 * dispatcher's — a fleet owner sees only their own vehicles/drivers, no
 * platform financial controls (payouts, owe, broadcasts stay
 * dispatcher/admin-only). One page today; more items can join the menu
 * here later if the fleet_owner role gains more scoped actions.
 */
export function CompanyLayout() {
  return <AppShell panelLabel="Company" menuItems={MENU_ITEMS} selectedKey="/company" />;
}
