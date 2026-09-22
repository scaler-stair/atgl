import { LogOut } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ScopeBar } from "@/components/shell/ScopeBar";
import { Sidebar } from "@/components/shell/Sidebar";
import { canView, ROLE_LABEL } from "@/lib/auth/rbac";
import { config } from "@/lib/config";
import { sites, zones } from "@/lib/domain/master";
import { NAV } from "@/lib/nav";
import { ensureAgentsBootstrapped } from "@/lib/server/agents";
import { currentUser } from "@/lib/server/session";
import { listAlerts } from "@/lib/server/workflow";
import { logoutAction } from "../actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustReset) redirect("/account/password");
  await ensureAgentsBootstrapped();

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => canView(user.role, i.module)) })).filter((g) => g.items.length);
  const openAlerts = canView(user.role, "alerts") ? (await listAlerts(user, { status: "open" })).length : 0;
  const visibleSites = sites.filter((s) => !user.siteIds || user.siteIds.includes(s.id));
  const visibleZones = zones.filter((z) => visibleSites.some((s) => s.zoneId === z.id));
  const scopedPaths = NAV.flatMap((g) => g.items).filter((i) => i.scoped).map((i) => i.href);

  const bandColor = { production: "var(--band-production)", staging: "var(--band-staging)", development: "var(--band-development)" }[config.appEnv];
  const bandText =
    config.appEnv === "production"
      ? `Production${config.dataMode === "synthetic" ? ", synthetic data" : ""}`
      : `${config.appEnv === "staging" ? "Staging" : "Development"} environment, ${config.dataMode} data. Not for operational decisions.`;

  return (
    <div className="min-h-dvh">
      <div className="no-print flex items-center justify-between gap-3 px-4 py-1 text-[12px] font-semibold text-white" style={{ background: bandColor }} role="note">
        <span>{bandText}</span>
        <span className="hidden sm:inline">Read-only intelligence layer. No operational write or control path.</span>
      </div>
      <div className="flex flex-col lg:flex-row">
        <Suspense fallback={<div className="hidden w-60 lg:block" />}>
          <div className="contents">
            <Sidebar groups={groups} openAlerts={openAlerts} tenantName={config.tenantName} />
          </div>
        </Suspense>
        <div className="min-w-0 flex-1">
          <header className="no-print sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 py-2.5 backdrop-blur sm:px-6">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Suspense>
                <ScopeBar zones={visibleZones.map((z) => ({ id: z.id, name: z.name }))} sites={visibleSites.map((s) => ({ id: s.id, name: s.name, zoneId: s.zoneId }))} scopedPaths={scopedPaths} />
              </Suspense>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/account/password" className="text-right leading-tight hover:underline" title="Account and password">
                <span className="block text-[13px] font-semibold text-ink">{user.displayName}</span>
                <span className="block text-[12px] text-ink-3">
                  {ROLE_LABEL[user.role]}
                  {user.siteIds ? `, ${user.siteIds.length} site${user.siteIds.length > 1 ? "s" : ""}` : ""}
                </span>
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="btn btn-quiet" title="Sign out" aria-label="Sign out">
                  <LogOut size={17} />
                </button>
              </form>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
