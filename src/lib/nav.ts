import type { ModuleKey } from "./auth/rbac";

export interface NavItem {
  module: ModuleKey;
  href: string;
  label: string;
  icon: string;
  /** Whether the scope/window bar applies on this page. */
  scoped?: boolean;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Network",
    items: [{ module: "overview", href: "/", label: "Overview", icon: "gauge", scoped: true }],
  },
  {
    group: "Intelligence",
    items: [
      { module: "energy", href: "/energy", label: "Energy", icon: "zap", scoped: true },
      { module: "gas", href: "/gas", label: "Gas and UAG", icon: "flame", scoped: true },
      { module: "metering", href: "/metering", label: "Metering", icon: "gauge-circle", scoped: true },
      { module: "reliability", href: "/reliability", label: "Asset reliability", icon: "cog", scoped: true },
      { module: "billing", href: "/billing", label: "Billing assurance", icon: "receipt", scoped: true },
      { module: "vendors", href: "/vendors", label: "Vendors and AMC", icon: "handshake", scoped: true },
      { module: "safety", href: "/safety", label: "Safety and integrity", icon: "shield", scoped: true },
    ],
  },
  {
    group: "Action",
    items: [
      { module: "opportunities", href: "/opportunities", label: "Opportunity register", icon: "target", scoped: true },
      { module: "alerts", href: "/alerts", label: "Alerts", icon: "bell", scoped: true },
      { module: "copilot", href: "/copilot", label: "Executive copilot", icon: "sparkles" },
      { module: "reports", href: "/reports", label: "Reports", icon: "file-text", scoped: true },
    ],
  },
  {
    group: "Governance",
    items: [
      { module: "data-quality", href: "/data-quality", label: "Data quality", icon: "activity" },
      { module: "agents", href: "/agents", label: "AI agents", icon: "bot" },
      { module: "admin-users", href: "/admin/users", label: "Users and roles", icon: "users" },
      { module: "admin-integrations", href: "/admin/integrations", label: "Integrations", icon: "plug" },
      { module: "admin-audit", href: "/admin/audit", label: "Audit log", icon: "scroll" },
      { module: "admin-health", href: "/admin/health", label: "System health", icon: "server" },
      { module: "sops", href: "/sops", label: "SOPs", icon: "book" },
    ],
  },
];
