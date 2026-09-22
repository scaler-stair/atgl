import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, Stat, Tag, type Tone } from "@/components/ui";
import { scopeLabel } from "@/lib/analytics/common";
import { meteringSummary, type MeterStatus } from "@/lib/analytics/metering";
import { inr, num, signed, titleCase } from "@/lib/format";
import { pageContext, type SearchParams } from "@/lib/server/page";

export const metadata: Metadata = { title: "Metering" };

const statusTone: Record<MeterStatus, Tone> = { fault: "crit", watch: "warn", ok: "ok" };
const statusText: Record<MeterStatus, string> = { fault: "Fault", watch: "Watch", ok: "OK" };
const filters = ["all", "fault", "watch", "ok"] as const;
type Filter = (typeof filters)[number];

function driftTone(d: number): Tone | undefined {
  const a = Math.abs(d);
  if (a >= 1.5) return "crit";
  if (a >= 0.75) return "warn";
  return undefined;
}

export default async function MeteringPage({ searchParams }: { searchParams: SearchParams }) {
  const { scope, windowKey, params } = await pageContext("metering", searchParams);
  const m = meteringSummary(scope, windowKey);
  const active: Filter = filters.includes(params.status as Filter) ? (params.status as Filter) : "all";
  const rows = active === "all" ? m.meters : m.meters.filter((r) => r.status === active);

  const hrefFor = (f: Filter) => {
    const q = new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== "status" && v) as [string, string][]);
    if (f !== "all") q.set("status", f);
    const s = q.toString();
    return s ? `/metering?${s}` : "/metering";
  };
  const countFor = (f: Filter) => (f === "all" ? m.meters.length : m.counts[f]);

  return (
    <>
      <PageHeader
        title="Metering health"
        description={`Drift against check meters, calibration age and diagnostics for fiscal, district and customer meters. ${scopeLabel(scope)}.`}
      />

      <Panel title="Meter status" description="Fault: drift at or beyond ±1.5% or failed diagnostics. Watch: drift from ±0.75%, overdue calibration or unit mismatch." evidence={m.evidence}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4">
          <Stat label="Fault" value={num(m.counts.fault)} tone={m.counts.fault ? "crit" : undefined} unit="meters" />
          <Stat label="Watch" value={num(m.counts.watch)} tone={m.counts.watch ? "warn" : undefined} unit="meters" />
          <Stat label="OK" value={num(m.counts.ok)} tone="ok" unit="meters" />
          <div className="col-span-2 md:col-span-1">
            <Stat label="Revenue exposure" value={inr(m.exposureInrPerDay)} unit="per day" tone="warn" indicative sub="Sales meters under-registering" />
          </div>
        </div>
      </Panel>

      <div className="mt-4 grid gap-4">
        <Panel
          title="Meters"
          description={`${rows.length} of ${m.meters.length} meters shown`}
          actions={
            <nav aria-label="Filter by status" className="flex overflow-hidden rounded-md border border-line bg-surface">
              {filters.map((f) => (
                <Link
                  key={f}
                  href={hrefFor(f)}
                  aria-current={active === f ? "page" : undefined}
                  className={`px-3 py-1.5 text-[13px] font-semibold ${active === f ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}
                >
                  {f === "all" ? "All" : statusText[f]} <span className="font-normal opacity-75">{countFor(f)}</span>
                </Link>
              ))}
            </nav>
          }
          bodyClass="p-0"
          evidence={m.evidence}
        >
          {rows.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No meters match this filter">Choose another status or widen the scope.</EmptyState>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Meter</th>
                    <th>Site</th>
                    <th>Role</th>
                    <th>Type</th>
                    <th>Customer</th>
                    <th className="num">Flow SCMH</th>
                    <th className="num">Drift</th>
                    <th className="num">Calibration age</th>
                    <th>Status</th>
                    <th>Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const dt = driftTone(r.driftPct);
                    return (
                      <tr key={r.meterId}>
                        <td className="font-medium whitespace-nowrap text-ink">{r.meterId}</td>
                        <td className="whitespace-nowrap text-ink-2">{r.siteName}</td>
                        <td className="whitespace-nowrap text-ink-2">{titleCase(r.role)}</td>
                        <td className="text-ink-2">{titleCase(r.tech)}</td>
                        <td className="text-ink-2">{r.customer ?? <span className="text-ink-3">n/a</span>}</td>
                        <td className="num">{num(r.flowScmh)}</td>
                        <td className="num">{dt ? <Tag tone={dt}>{signed(r.driftPct, 2)}</Tag> : signed(r.driftPct, 2)}</td>
                        <td className="num">
                          {r.calibrationOverdue ? <Tag tone="warn" title="Policy: recalibrate within 365 days">{num(r.calibrationAgeDays)} days</Tag> : `${num(r.calibrationAgeDays)} days`}
                        </td>
                        <td>
                          <Tag tone={statusTone[r.status]}>{statusText[r.status]}</Tag>
                        </td>
                        <td className="min-w-56 text-[12.5px] text-ink-2">
                          {r.reasons.length ? (
                            <ul className="space-y-0.5">
                              {r.reasons.map((x) => (
                                <li key={x}>{x}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-ink-3">Within limits</span>
                          )}
                          {r.exposureInrPerDay > 0 && <p className="mt-0.5 text-ink">Exposure {inr(r.exposureInrPerDay)} per day (indicative)</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Fiscal accuracy workflow" description="What happens after a meter is flagged. The dashboard only reports; teams act in their own systems.">
          <ol className="grid list-decimal gap-x-8 gap-y-3 pl-5 md:grid-cols-2 xl:grid-cols-4 text-[13px] text-ink-2 marker:font-semibold marker:text-ink">
            <li>
              <span className="font-semibold text-ink">Proving run.</span> Compare the flagged meter against a master or check meter under normal flow to confirm the drift.
            </li>
            <li>
              <span className="font-semibold text-ink">Recalibrate or replace.</span> If drift is confirmed beyond ±1.5%, or diagnostics fail, the meter is recalibrated or swapped under the metering procedure.
            </li>
            <li>
              <span className="font-semibold text-ink">Supplementary billing review.</span> For sales meters that under-registered, billing reviews the affected period and decides on any supplementary invoice.
            </li>
            <li>
              <span className="font-semibold text-ink">Close and watch.</span> Record the as-found and as-left readings, then confirm drift stays inside ±0.75% over the next cycle.
            </li>
          </ol>
        </Panel>
      </div>
    </>
  );
}
