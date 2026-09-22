import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, EvidenceStrip, KeyValue, Notice, PageHeader, Panel, Stat, Tag, type Tone } from "@/components/ui";
import { agentById } from "@/lib/agents/definitions";
import { can, ROLE_LABEL } from "@/lib/auth/rbac";
import { siteById, zoneById } from "@/lib/domain/master";
import { date, inr, titleCase } from "@/lib/format";
import { pageContext, type SearchParams } from "@/lib/server/page";
import { listUsers } from "@/lib/server/users";
import { listOpportunities } from "@/lib/server/workflow";
import { EditOpportunity, ValidateOpportunity } from "./OpportunityActions";

export const metadata: Metadata = { title: "Opportunity register" };

const statusTone: Record<string, Tone> = { identified: "neutral", "under-review": "info", approved: "flow", "in-progress": "flow", implemented: "ok", rejected: "neutral" };

export default async function OpportunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, filter, params } = await pageContext("opportunities", searchParams);
  const all = await listOpportunities(user, filter);
  const shown = all.filter((o) => (!params.domain || o.domain === params.domain) && (!params.status || o.status === params.status));
  const live = all.filter((o) => o.status !== "rejected");
  const indicative = live.filter((o) => o.validation === "indicative").reduce((t, o) => t + o.impactInr, 0);
  const validated = live.filter((o) => o.validation === "validated").reduce((t, o) => t + (o.validatedValueInr ?? 0), 0);
  const implemented = live.filter((o) => o.status === "implemented").reduce((t, o) => t + (o.validatedValueInr ?? o.impactInr), 0);
  const domains = [...new Set(all.map((o) => o.domain))].sort();
  const canEdit = can(user.role, "opportunity.edit");
  const canValidate = can(user.role, "opportunity.validate");
  const owners = canEdit
    ? (await listUsers())
        .filter((u) => u.status === "active" && ["operations", "engineering", "finance", "leadership", "site_user"].includes(u.role))
        .map((u) => ({ id: u.id, name: u.displayName, role: ROLE_LABEL[u.role] }))
    : [];

  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ zone: filter.zone, site: filter.site, window: params.window, domain: params.domain, status: params.status, ...patch })) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/opportunities?${s}` : "/opportunities";
  };

  return (
    <>
      <PageHeader
        title="Opportunity register"
        description="Every opportunity the agents identify, with its rupee impact, recommendation, owner, evidence and validation state. Values are indicative until leadership validates them against the approved business case."
      />

      {params.done && (
        <div role="status" className="mb-4 rounded-md border border-transparent bg-ok-soft px-3 py-2 text-[13px] font-semibold text-ok">
          {{ approved: "Value validated and approved.", validated: "Value validated.", updated: "Opportunity updated." }[params.done] ?? "Saved."}
        </div>
      )}

      <Panel className="mb-4">
        <div className="flex flex-wrap gap-x-12 gap-y-4">
          <Stat label="Indicative value per year" value={inr(indicative)} indicative sub={`${live.filter((o) => o.validation === "indicative").length} opportunities`} />
          <Stat label="Validated value per year" value={inr(validated)} tone={validated ? "ok" : undefined} sub={`${live.filter((o) => o.validation === "validated").length} validated`} />
          <Stat label="Implemented" value={inr(implemented)} sub={`${live.filter((o) => o.status === "implemented").length} closed out`} />
          <Stat label="Unassigned" value={String(live.filter((o) => !o.ownerId).length)} sub="Need an owner" tone={live.some((o) => !o.ownerId) ? "warn" : undefined} />
        </div>
      </Panel>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Link href={href({ domain: undefined })} className={`rounded px-2 py-1 text-[12.5px] ${!params.domain ? "bg-surface font-semibold text-ink ring-1 ring-line" : "text-ink-2"}`}>
          All domains <span className="tabular text-ink-3">{all.length}</span>
        </Link>
        {domains.map((d) => (
          <Link key={d} href={href({ domain: d })} className={`rounded px-2 py-1 text-[12.5px] ${params.domain === d ? "bg-surface font-semibold text-ink ring-1 ring-line" : "text-ink-2"}`}>
            {titleCase(d)} <span className="tabular text-ink-3">{all.filter((o) => o.domain === d).length}</span>
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState title="No opportunities in this scope">Widen the zone or site filter, or run the agents from the AI agents page.</EmptyState>
      ) : (
        <Panel bodyClass="p-0">
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_150px_160px_120px] gap-3 border-b border-line bg-surface-2 px-4 py-2 text-[12px] font-semibold text-ink-2 lg:grid">
            <span>Opportunity</span>
            <span>Domain</span>
            <span className="text-right">Value per year</span>
            <span>Owner</span>
            <span>Status</span>
          </div>
          <ul>
            {shown.map((o) => {
              const where = o.siteId ? siteById.get(o.siteId)?.name : o.zoneId ? `${zoneById.get(o.zoneId)?.name} zone` : "Network-wide";
              return (
                <li key={o.id} className="border-b border-line-2 last:border-b-0">
                  <details open={params.focus === o.id}>
                    <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2 lg:grid-cols-[minmax(0,1fr)_110px_150px_160px_120px]">
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">{o.title}</span>
                        <span className="block text-[12px] text-ink-3">{where}</span>
                      </span>
                      <span className="hidden text-ink-2 lg:block">{titleCase(o.domain)}</span>
                      <span className="text-right">
                        <span className="tabular block font-display text-[17px] font-semibold text-ink">{inr(o.validation === "validated" ? o.validatedValueInr : o.impactInr)}</span>
                        <Tag tone={o.validation === "validated" ? "ok" : "warn"}>{o.validation === "validated" ? "Validated" : "Indicative"}</Tag>
                      </span>
                      <span className="text-[13px] text-ink-2">{o.ownerName ?? (o.ownerRole ? `Suggested: ${ROLE_LABEL[o.ownerRole]}` : "Unassigned")}</span>
                      <span>
                        <Tag tone={statusTone[o.status]}>{titleCase(o.status)}</Tag>
                      </span>
                    </summary>
                    <div className="space-y-4 border-t border-line-2 bg-surface-2/50 px-4 py-4">
                      <KeyValue
                        items={[
                          ["Recommendation", o.recommendation],
                          ["Value basis", o.impactBasis],
                          ["Agent estimate", `${inr(o.impactInr)} per year (indicative)`],
                          ...(o.validation === "validated" ? ([["Validated", `${inr(o.validatedValueInr)} by ${o.validatedBy} on ${date(o.validatedAt)}`]] as [string, string][]) : []),
                          ["Identified by", `${agentById.get(o.sourceAgent)?.name ?? o.sourceAgent}, ${date(o.createdAt)}`],
                        ]}
                      />
                      <EvidenceStrip evidence={o.evidence} />
                      {canEdit && <EditOpportunity id={o.id} status={o.status} ownerId={o.ownerId} owners={owners} />}
                      {canValidate && o.validation === "indicative" && <ValidateOpportunity id={o.id} suggested={o.impactInr} />}
                      {!canEdit && !canValidate && <p className="text-[12.5px] text-ink-3">Your role can view the register but not change it.</p>}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      <div className="mt-4">
        <Notice title="How values move from indicative to validated">
          Agents size each opportunity from read-only data using the stated basis. During the 30 to 60 day ATGL study the owner confirms the figure; leadership then records the validated value, and only validated opportunities can be approved for implementation.
        </Notice>
      </div>
    </>
  );
}
