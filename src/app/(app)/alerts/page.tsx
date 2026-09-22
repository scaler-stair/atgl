import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, EvidenceStrip, KeyValue, PageHeader, Panel, SeverityTag, Tag } from "@/components/ui";
import { agentById } from "@/lib/agents/definitions";
import { can, ROLE_LABEL } from "@/lib/auth/rbac";
import { siteById, zoneById } from "@/lib/domain/master";
import { ago, dateTime, titleCase } from "@/lib/format";
import { pageContext, type SearchParams } from "@/lib/server/page";
import { listAlerts } from "@/lib/server/workflow";
import { AlertActions } from "./AlertActions";

export const metadata: Metadata = { title: "Alerts" };

const STATUSES = [
  { key: "open", label: "Open" },
  { key: "acknowledged", label: "Acknowledged" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

export default async function AlertsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, filter, params } = await pageContext("alerts", searchParams);
  const status = STATUSES.some((s) => s.key === params.status) ? params.status! : "open";
  const mine = params.queue === "mine";
  const all = await listAlerts(user, { ...filter, status: "all" });
  const shown = all.filter((a) => (status === "all" || a.status === status) && (!params.domain || a.domain === params.domain) && (!mine || a.routeRole === user.role));
  const domains = [...new Set(all.map((a) => a.domain))].sort();

  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { zone: filter.zone, site: filter.site, window: params.window, status, domain: params.domain, queue: params.queue, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "status" && v === "open")) q.set(k, v);
    const s = q.toString();
    return s ? `/alerts?${s}` : "/alerts";
  };
  const count = (st: string) => all.filter((a) => st === "all" || a.status === st).length;
  const canAck = can(user.role, "alert.acknowledge");
  const canClose = can(user.role, "alert.close");

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Raised by the agents, classified by domain and severity, and routed to the responsible role. Every acknowledgement and closure is recorded with the action taken and its evidence (SOP-06)."
      />

      {params.done && (
        <div role="status" className="mb-4 rounded-md border border-transparent bg-ok-soft px-3 py-2 text-[13px] font-semibold text-ok">
          {params.done === "closed" ? "Alert closed. The action and evidence are recorded in the audit log." : "Alert acknowledged."}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Alert status" className="flex overflow-hidden rounded-md border border-line bg-surface">
          {STATUSES.map((s) => (
            <Link key={s.key} href={href({ status: s.key })} aria-current={status === s.key ? "page" : undefined} className={`px-3 py-1.5 text-[13px] font-semibold ${status === s.key ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}>
              {s.label} <span className="tabular font-normal opacity-75">{count(s.key)}</span>
            </Link>
          ))}
        </nav>
        <Link href={href({ queue: mine ? undefined : "mine" })} className={`btn ${mine ? "border-brand text-brand" : ""}`} aria-pressed={mine}>
          {mine ? "Showing my queue" : `Only routed to ${ROLE_LABEL[user.role].toLowerCase()}`}
        </Link>
        <div className="flex flex-wrap gap-1.5">
          <Link href={href({ domain: undefined })} className={`rounded px-2 py-1 text-[12.5px] ${!params.domain ? "bg-surface font-semibold text-ink ring-1 ring-line" : "text-ink-2"}`}>
            All domains
          </Link>
          {domains.map((d) => (
            <Link key={d} href={href({ domain: d })} className={`rounded px-2 py-1 text-[12.5px] ${params.domain === d ? "bg-surface font-semibold text-ink ring-1 ring-line" : "text-ink-2"}`}>
              {titleCase(d)}
            </Link>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState title="No alerts match these filters">Change the status or domain filter, or widen the zone and site scope.</EmptyState>
      ) : (
        <Panel bodyClass="p-0">
          <ul>
            {shown.map((a) => {
              const where = a.siteId ? siteById.get(a.siteId)?.name ?? a.siteId : a.zoneId ? `${zoneById.get(a.zoneId)?.name} zone` : "Network-wide";
              return (
                <li key={a.id} id={a.id} className="border-b border-line-2 last:border-b-0">
                  <details open={params.focus === a.id} className="group">
                    <summary className="flex cursor-pointer list-none flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2">
                      <SeverityTag severity={a.severity} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-ink">{a.title}</span>
                        <span className="block text-[12px] text-ink-3">
                          {where}, {titleCase(a.domain)}, raised {ago(a.createdAt)}, last seen {ago(a.lastSeenAt)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {a.routeRole === user.role && <Tag tone="brand">Your queue</Tag>}
                        <Tag>{ROLE_LABEL[a.routeRole]}</Tag>
                        <Tag tone={a.status === "open" ? "crit" : a.status === "acknowledged" ? "warn" : "ok"}>{titleCase(a.status)}</Tag>
                      </span>
                    </summary>
                    <div className="space-y-4 border-t border-line-2 bg-surface-2/50 px-4 py-4">
                      <p className="max-w-4xl text-[13.5px] text-ink">{a.detail}</p>
                      <EvidenceStrip evidence={a.evidence} />
                      <KeyValue
                        items={[
                          ["Raised by", `${agentById.get(a.sourceAgent)?.name ?? a.sourceAgent}, ${dateTime(a.createdAt)} IST`],
                          ["Acknowledged", a.ackAt ? `${a.ackBy}, ${dateTime(a.ackAt)}` : "Not yet"],
                          ["Closed", a.closedAt ? `${a.closedBy}, ${dateTime(a.closedAt)}` : "Not yet"],
                          ...(a.actionNote ? ([["Action", a.actionNote]] as [string, string][]) : []),
                          ...(a.closureEvidence ? ([["Evidence", a.closureEvidence]] as [string, string][]) : []),
                        ]}
                      />
                      {(canAck || canClose) && a.status !== "closed" ? (
                        <AlertActions id={a.id} status={a.status} canAck={canAck} canClose={canClose} />
                      ) : a.status !== "closed" ? (
                        <p className="text-[12.5px] text-ink-3">Your role can view this alert but not act on it.</p>
                      ) : null}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </>
  );
}
