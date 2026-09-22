import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { pageContext, type SearchParams } from "@/lib/server/page";

export const metadata: Metadata = { title: "SOPs" };

const SOPS: { id: string; topic: string; procedure: string; where: { href: string; label: string } }[] = [
  { id: "SOP-01", topic: "Environment onboarding", procedure: "Create ATGL production/staging environments; configure approved network paths, tenant, users, secrets and monitoring.", where: { href: "/admin/health", label: "System health" } },
  { id: "SOP-02", topic: "Data-source onboarding", procedure: "Register source, owner, fields/tags, frequency, units, read-only account, expected freshness and fallback process.", where: { href: "/admin/integrations", label: "Integrations" } },
  { id: "SOP-03", topic: "Data-quality operations", procedure: "Review stale/missing/outlier queues daily; assign owners; document resolution; do not silently backfill without provenance.", where: { href: "/data-quality", label: "Data quality" } },
  { id: "SOP-04", topic: "Dashboard operations", procedure: "Review KPI freshness, alert queues and opportunity register; record manual overrides and approvals.", where: { href: "/", label: "Network overview" } },
  { id: "SOP-05", topic: "AI model/prompt release", procedure: "Version model/prompt/rules; test against golden cases; approve release; retain rollback version.", where: { href: "/agents", label: "AI agents" } },
  { id: "SOP-06", topic: "Alert management", procedure: "Classify alerts by domain and severity; route to owner; record acknowledgement, action, closure and evidence.", where: { href: "/alerts", label: "Alerts" } },
  { id: "SOP-07", topic: "Cyber/security incident", procedure: "Disable suspect credentials, preserve logs, notify security owner, isolate affected connector, restore from approved baseline when required.", where: { href: "/admin/users", label: "Users and roles" } },
  { id: "SOP-08", topic: "Backup/restore", procedure: "Automated backup of configuration, database and approved documents; periodic restore test; record RPO/RTO evidence.", where: { href: "/admin/health", label: "System health" } },
  { id: "SOP-09", topic: "Change control", procedure: "Any schema, connector, rules, model, dashboard or role change moves through staging, approval and rollback-ready production release.", where: { href: "/admin/audit", label: "Audit log" } },
  { id: "SOP-10", topic: "New site/client onboarding", procedure: "Use a configuration-driven template: environment, site hierarchy, connector profile, role matrix, dashboards, alerts, UAT and sign-off.", where: { href: "/admin/integrations", label: "Integrations" } },
];

export default async function SopsPage({ searchParams }: { searchParams: SearchParams }) {
  await pageContext("sops", searchParams);
  return (
    <>
      <PageHeader title="Standard operating procedures" description="The ten procedures that govern how the platform is run, changed and recovered. Each links to the page where the work is done." />

      <nav aria-label="SOP index" className="mb-4 flex flex-wrap gap-1.5">
        {SOPS.map((s) => (
          <a key={s.id} href={`#${s.id.toLowerCase()}`} className="rounded border border-line bg-surface px-2 py-0.5 text-[12.5px] font-semibold text-ink-2 hover:text-ink">
            {s.id}
          </a>
        ))}
      </nav>

      <ol className="overflow-hidden rounded-lg border border-line bg-surface">
        {SOPS.map((s) => (
          <li key={s.id} id={s.id.toLowerCase()} className="scroll-mt-20 border-b border-line-2 px-4 py-4 last:border-b-0 sm:grid sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:gap-4">
            <p className="font-display text-[15px] font-semibold text-brand tabular">
              <a href={`#${s.id.toLowerCase()}`} className="hover:underline" aria-label={`Link to ${s.id}`}>{s.id}</a>
            </p>
            <div className="min-w-0">
              <h2 className="font-display text-[17px] font-semibold leading-6 text-ink">{s.topic}</h2>
              <p className="mt-0.5 text-[14px] text-ink-2">{s.procedure}</p>
            </div>
            <p className="mt-2 text-[13px] sm:mt-0 sm:text-right">
              <span className="block text-[12px] text-ink-3">Where in the platform</span>
              <Link href={s.where.href} className="font-semibold text-flow hover:underline">
                {s.where.label}
              </Link>
            </p>
          </li>
        ))}
      </ol>
    </>
  );
}
