import type { Metadata } from "next";
import { EmptyState, Notice, Panel, PageHeader, SeverityTag, Stat, TableWrap, Tag, type Tone } from "@/components/ui";
import { can } from "@/lib/auth/rbac";
import { connectorStatuses, type ConnectorState } from "@/lib/connectors";
import { ago, dateTime, num, titleCase } from "@/lib/format";
import { pageContext, type SearchParams } from "@/lib/server/page";
import { listDqIssues, type DqIssue } from "@/lib/server/workflow";
import { DqActions } from "./DqActions";

export const metadata: Metadata = { title: "Data quality" };

const stateTone: Record<ConnectorState, Tone> = { healthy: "ok", degraded: "warn", failed: "crit" };
const statusTone: Record<DqIssue["status"], Tone> = { open: "crit", assigned: "warn", resolved: "ok" };

function lag(min: number): string {
  if (min < 60) return `${num(min)} min`;
  if (min < 48 * 60) return `${num(min / 60, 1)} h`;
  return `${num(min / 1440, 1)} days`;
}

export default async function DataQualityPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await pageContext("data-quality", searchParams);
  const sources = connectorStatuses();
  const issues = await listDqIssues();
  const canAct = can(user.role, "dq.resolve");
  const open = issues.filter((i) => i.status === "open").length;
  const assigned = issues.filter((i) => i.status === "assigned").length;
  const stale = sources.filter((s) => s.lagMinutes > s.expectedFreshnessMin || s.state !== "healthy").length;

  return (
    <>
      <PageHeader
        title="Data quality"
        description="Freshness of every read-only source and the queue of stale, missing and outlier data raised by the data quality agent. Reviewed daily under SOP-03."
      />

      <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-4">
        <Stat label="Sources" value={sources.length} sub={`${sources.length - stale} within expected freshness`} />
        <Stat label="Sources late or degraded" value={stale} tone={stale ? "warn" : "ok"} />
        <Stat label="Open issues" value={open} tone={open ? "crit" : "ok"} sub="Not yet assigned" />
        <Stat label="Assigned" value={assigned} tone={assigned ? "warn" : undefined} sub="Owner working on it" />
      </div>

      <Panel title="Source freshness" description="Lag is the time since the last good sample, compared with the freshness agreed for the source (SOP-02)." bodyClass="p-4">
        <TableWrap>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">State</th>
                <th scope="col" className="num">Lag</th>
                <th scope="col" className="num">Expected</th>
                <th scope="col">Last good sample</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const late = s.lagMinutes > s.expectedFreshnessMin;
                return (
                  <tr key={s.id}>
                    <td>
                      <span className="font-semibold text-ink">{s.name}</span>
                      <span className="block text-[12px] text-ink-3">{s.system}, {s.owner}</span>
                    </td>
                    <td>
                      <Tag tone={stateTone[s.state]}>{titleCase(s.state)}</Tag>
                    </td>
                    <td className={`num ${late ? "font-semibold text-crit" : ""}`}>{lag(s.lagMinutes)}</td>
                    <td className="num text-ink-2">within {lag(s.expectedFreshnessMin)}</td>
                    <td className="whitespace-nowrap">
                      {dateTime(s.lastGoodSample)}
                      <span className="block text-[12px] text-ink-3">{ago(s.lastGoodSample)}</span>
                    </td>
                    <td className="text-[13px] text-ink-2">{s.message ?? (late ? "Later than expected" : "Within expected freshness")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      <Panel
        className="mt-4"
        title="Issue queue"
        description={`${issues.length} issue${issues.length === 1 ? "" : "s"}; open first, then by severity`}
        bodyClass="p-4"
      >
        <div className="mb-4">
          <Notice tone="warn" title="Do not silently backfill (SOP-03)">
            Every resolution must say what was fixed and where any corrected values came from. Gaps that cannot be recovered from an approved source stay flagged.
          </Notice>
        </div>
        {!canAct && <p className="mb-3 text-[13px] text-ink-2">Your role can view this queue. Operations and engineering users assign and resolve issues.</p>}
        {issues.length === 0 ? (
          <EmptyState title="No data-quality issues">The data quality agent has not raised any issues.</EmptyState>
        ) : (
          <div className="-mx-4 -mb-4 overflow-auto border-t border-line-2">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Issue</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Status</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Detected</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">Resolution</th>
                  {canAct && <th scope="col">Action</th>}
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={i.id}>
                    <td className="min-w-72">
                      <span className="font-semibold text-ink">{i.entity}</span>
                      <span className="ml-2 text-[12px] text-ink-3">{titleCase(i.kind)} from {i.source}</span>
                      <p className="mt-0.5 text-[13px] text-ink-2">{i.detail}</p>
                    </td>
                    <td>
                      <SeverityTag severity={i.severity} />
                    </td>
                    <td>
                      <Tag tone={statusTone[i.status]}>{titleCase(i.status)}</Tag>
                    </td>
                    <td className="whitespace-nowrap text-[13px]">
                      {i.ownerName ?? <span className="text-ink-3">Unassigned</span>}
                      {i.ownerRole && <span className="block text-[12px] text-ink-3">Routed to {titleCase(i.ownerRole)}</span>}
                    </td>
                    <td className="whitespace-nowrap text-[13px]">{dateTime(i.detectedAt)}</td>
                    <td className="whitespace-nowrap text-[13px]">{ago(i.lastSeenAt)}</td>
                    <td className="min-w-48 text-[13px] text-ink-2">
                      {i.resolution ? (
                        <>
                          {i.resolution}
                          <span className="block text-[12px] text-ink-3">{dateTime(i.resolvedAt)}</span>
                        </>
                      ) : (
                        <span className="text-ink-3">Not resolved</span>
                      )}
                    </td>
                    {canAct && <td><DqActions id={i.id} canAssign={i.ownerId !== user.id} resolved={i.status === "resolved"} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
