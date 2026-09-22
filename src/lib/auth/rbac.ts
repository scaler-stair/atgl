/**
 * Role matrix (Section 5). Pure data so both server guards and navigation use
 * one source of truth. Server code must always re-check with `can()`; hiding a
 * link is never the control.
 */

export const ROLES = [
  "platform_admin",
  "leadership",
  "operations",
  "engineering",
  "finance",
  "security",
  "site_user",
  "viewer",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  platform_admin: "Platform admin",
  leadership: "ATGL leadership",
  operations: "Operations",
  engineering: "Engineering / reliability",
  finance: "Finance / billing",
  security: "IT/OT security",
  site_user: "Site user",
  viewer: "Read-only viewer",
};

export const ROLE_SUMMARY: Record<Role, { access: string; restriction: string }> = {
  platform_admin: { access: "Tenant and environment configuration, users, integrations, system health", restriction: "No business approval rights by default" },
  leadership: { access: "Executive KPIs, opportunities, reports, alerts", restriction: "No configuration or source-data mutation" },
  operations: { access: "Site, asset, energy and gas views, alerts and assigned actions", restriction: "Only assigned site/role scope" },
  engineering: { access: "Asset health, engineering diagnostics, relevant intelligence", restriction: "No OT control/write" },
  finance: { access: "Billing assurance, metering and validated opportunity views", restriction: "No OT control/write" },
  security: { access: "Integration health, access logs, network/security evidence", restriction: "No business data editing" },
  site_user: { access: "Assigned site dashboards and action workflows", restriction: "Site-scoped" },
  viewer: { access: "Published dashboards and reports", restriction: "No write actions" },
};

export type ModuleKey =
  | "overview"
  | "energy"
  | "gas"
  | "metering"
  | "reliability"
  | "billing"
  | "vendors"
  | "safety"
  | "opportunities"
  | "alerts"
  | "reports"
  | "copilot"
  | "data-quality"
  | "agents"
  | "admin-users"
  | "admin-integrations"
  | "admin-audit"
  | "admin-health"
  | "sops";

const BUSINESS: Role[] = ["leadership", "operations", "engineering", "viewer"];

const VIEW: Record<ModuleKey, Role[]> = {
  overview: [...ROLES],
  energy: [...BUSINESS, "finance", "site_user"],
  gas: [...BUSINESS, "finance", "site_user"],
  metering: [...BUSINESS, "finance"],
  reliability: [...BUSINESS, "site_user"],
  billing: ["leadership", "finance", "viewer"],
  vendors: [...BUSINESS, "finance"],
  safety: [...BUSINESS, "site_user"],
  opportunities: [...BUSINESS, "finance"],
  alerts: ["leadership", "operations", "engineering", "finance", "site_user", "security"],
  reports: [...BUSINESS, "finance"],
  copilot: ["leadership", "operations", "engineering", "finance", "site_user"],
  "data-quality": ["platform_admin", "operations", "engineering", "security"],
  agents: ["platform_admin", "leadership", "engineering", "security"],
  "admin-users": ["platform_admin"],
  "admin-integrations": ["platform_admin", "security"],
  "admin-audit": ["platform_admin", "security"],
  "admin-health": ["platform_admin", "security"],
  sops: [...ROLES],
};

export type Action =
  | "alert.acknowledge"
  | "alert.close"
  | "opportunity.edit"
  | "opportunity.validate"
  | "dq.resolve"
  | "agent.run"
  | "report.generate"
  | "user.manage";

const ACT: Record<Action, Role[]> = {
  "alert.acknowledge": ["operations", "engineering", "finance", "site_user", "security"],
  "alert.close": ["operations", "engineering", "finance", "security"],
  "opportunity.edit": ["operations", "engineering", "finance"],
  "opportunity.validate": ["leadership"],
  "dq.resolve": ["operations", "engineering"],
  "agent.run": ["platform_admin", "engineering"],
  "report.generate": ["leadership", "operations", "engineering", "finance"],
  "user.manage": ["platform_admin"],
};

export function canView(role: Role, module: ModuleKey): boolean {
  return VIEW[module].includes(role);
}

export function can(role: Role, action: Action): boolean {
  return ACT[action].includes(role);
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}
