import type { ThemeConfig } from "antd";

/**
 * Single source of truth for the platform's visual identity — every panel
 * (admin/dispatcher/company/rider/driver) shares this via ConfigProvider in
 * main.tsx, so a brand tweak only ever happens in one place.
 */
export const brand = {
  primary: "#4F46E5", // indigo — the platform's core brand color
  primaryDark: "#3730A3",
  accent: "#F59E0B", // amber — used sparingly for emphasis (active states, highlights)
  sidebarBg: "#14142B", // near-black indigo, not AntD's default dark navy
  sidebarBgActive: "rgba(79, 70, 229, 0.35)",
  pageBg: "#F4F5FA",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
};

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: brand.primary,
    colorLink: brand.primary,
    borderRadius: 10,
    fontFamily: brand.fontFamily,
    colorBgLayout: brand.pageBg,
    fontSize: 14,
  },
  components: {
    Layout: {
      headerBg: "#ffffff",
      bodyBg: brand.pageBg,
      siderBg: brand.sidebarBg,
    },
    Menu: {
      darkItemBg: "transparent",
      darkItemSelectedBg: brand.sidebarBgActive,
      darkItemHoverBg: "rgba(255,255,255,0.06)",
      darkItemColor: "rgba(255,255,255,0.72)",
      darkItemSelectedColor: "#ffffff",
      itemBorderRadius: 8,
      itemMarginInline: 12,
    },
    Card: {
      borderRadiusLG: 14,
      boxShadowTertiary: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
    },
    Button: {
      controlHeight: 38,
      fontWeight: 500,
    },
    Table: {
      headerBg: "#F9FAFC",
      borderRadius: 10,
    },
    Statistic: {
      titleFontSize: 13,
    },
  },
};
