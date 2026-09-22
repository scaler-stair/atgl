import type { Metadata } from "next";
import Link from "next/link";
import { RankBars } from "@/components/bars";
import { TrendChart } from "@/components/charts";
import { EvidenceStrip, Panel, PageHeader, QualityPip, SeverityTag, Stat, Tag, type Tone } from "@/components/ui";
import { scopeLabel } from "@/lib/analytics/common";
import { energySummary } from "@/lib/analytics/energy";
import { overview } from "@/lib/analytics/overview";
import { canView, type ModuleKey } from "@/lib/auth/rbac";
import type { Evidence } from "@/lib/domain/types";
import { ago, inr, num, pct } from "@/lib/format";
import { latestRuns } from "@/lib/server/agents";
import { pageContext, type SearchParams } from "@/lib/server/page";
import { listAlerts, listOpportunities } from "@/lib/server/workflow";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, scope, windowKey, filter } = await pageContext("overview", searchParams);
  const o = overview(scope, windowKey);
  const hourly = energySummary(scope, windowKey).hourly;
  const alerts = canView(user.role, "alerts") ? await listAlerts(user, { ...filter, status: "open" }) : [];
  const opps = canView(user.role, "opportunities") ? await listOpportunities(user, filter) : [];
  const runs = await latestRuns();
  const lastRun = Math.max(...[...runs.values()].map((r) => r.finished_at ?? 0));
  const qs = new URLSearchParams(Object.entries({ ...filter, window: windowKey === "7d" ? undefined : windowKey }).filter(([, v]) => v) as [string, string][]).toString();
  const link = (p: string) => (qs ? `${p}?${qs}` : p);

  const board: { module: ModuleKey; href: string; domain: string; headline: string; detail: string; tone: Tone; state: string; evidence: Evidence }[] = [
    {
      module: "energy",
      href: "/energy",
      domain: "Energy",
      headline: `${num(o.energy.networkSec, 3)} kWh/kg`,
      detail: `Benchmark ${num(o.energy.benchmarkSec, 3)}; excess ${inr(o.energy.excessInr)} in window`,
      tone: (o.energy.networkSec ?? 0) > (o.energy.benchmarkSec ?? 0) * 1.05 ? "warn" : "ok",
      state: (o.energy.networkSec ?? 0) > (o.energy.benchmarkSec ?? 0) * 1.05 ? "Above benchmark" : "Near benchmark",
      evidence: o.energy.evidence,
    },
    {
      module: "gas",
      href: "/gas",
      domain: "Gas and UAG",
      headline: pct(o.gas.uagPct, 2),
      detail: `${num(o.gas.uagScm)} SCM unaccounted, ${inr(o.gas.uagValueInr)} at gas cost`,
      tone: o.gas.uagPct > 1.2 ? "crit" : o.gas.uagPct > 0.9 ? "warn" : "ok",
      state: o.gas.uagPct > 1.2 ? "Above 1.2% limit" : "Within limit",
      evidence: o.gas.evidence,
    },
    {
      module: "metering",
      href: "/metering",
      domain: "Metering",
      headline: `${o.metering.counts.fault} fault, ${o.metering.counts.watch} watch`,
      detail: `Revenue exposure ${inr(o.metering.exposureInrPerDay)} per day`,
      tone: o.metering.counts.fault ? "crit" : o.metering.counts.watch ? "warn" : "ok",
      state: o.metering.counts.fault ? "Faults open" : "Healthy",
      evidence: o.metering.evidence,
    },
    {
      module: "reliability",
      href: "/reliability",
      domain: "Asset reliability",
      headline: `${o.reliability.counts.alert} in alert`,
      detail: o.reliability.worst[0] ? `Lowest: ${o.reliability.worst[0].siteName}, ${o.reliability.worst[0].name} (${o.reliability.worst[0].health}/100)` : "No monitored assets",
      tone: o.reliability.counts.alert ? "crit" : o.reliability.counts.watch ? "warn" : "ok",
      state: o.reliability.counts.alert ? "Action advised" : "Stable",
      evidence: o.reliability.evidence,
    },
    {
      module: "billing",
      href: "/billing",
      domain: "Billing assurance",
      headline: `${o.billing.exceptions} exceptions`,
      detail: `${inr(o.billing.atStakeInr)} at stake, pending review`,
      tone: o.billing.exceptions ? "warn" : "ok",
      state: o.billing.exceptions ? "Review queue" : "Reconciled",
      evidence: o.billing.evidence,
    },
    {
      module: "vendors",
      href: "/vendors",
      domain: "Vendors and AMC",
      headline: `${o.vendor.breach} breach, ${o.vendor.atRisk} at risk`,
      detail: `${o.vendor.total} contracts in scope`,
      tone: o.vendor.breach ? "crit" : o.vendor.atRisk ? "warn" : "ok",
      state: o.vendor.breach ? "SLA breach" : "On track",
      evidence: o.vendor.evidence,
    },
    {
      module: "safety",
      href: "/safety",
      domain: "Safety and integrity",
      headline: `CP ${pct(o.safety.cpCompliancePct)}`,
      detail: `${o.safety.openHighEvents} open high-severity, ${o.safety.unpermittedExcavations} unpermitted excavation(s)`,
      tone: o.safety.openHighEvents ? "crit" : o.safety.cpCompliancePct < 98 ? "warn" : "ok",
      state: o.safety.openHighEvents ? "Open high events" : "Compliant",
      evidence: o.safety.evidence,
    },
  ];
  const visibleBoard = board.filter((b) => canView(user.role, b.module));
  const indicative = opps.filter((x) => x.validation === "indicative" && x.status !== "rejected").reduce((t, x) => t + x.impactInr, 0);
  const validated = opps.filter((x) => x.validation === "validated" && x.status !== "rejected").reduce((t, x) => t + (x.validatedValueInr ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Network overview"
        description={`${scopeLabel(scope)}, ${o.energy.evidence.window.label.toLowerCase()}. Agents last ran ${ago(lastRun)}.`}
      />

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        {canView(user.role, "energy") && (
          <Panel
            title="Compression energy"
            description="Hourly electricity drawn by compressors and station auxiliaries, with specific energy per kg of CNG"
            actions={<Link href={link("/energy")} className="btn">Open energy</Link>}
            evidence={o.energy.evidence}
          >
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Specific energy" value={num(o.energy.networkSec, 3)} unit="kWh/kg" sub={`Best-quartile ${num(o.energy.benchmarkSec, 3)}`} />
              <Stat label="Electricity" value={num(o.energy.totalKwh / 1000, 1)} unit="MWh" />
              <Stat label="Excess over benchmark" value={inr(o.energy.excessInr)} tone="warn" indicative />
            </div>
            <div className="mt-4">
              <TrendChart
                data={hourly}
                series={[
                  { key: "kwh", label: "Electricity", color: "var(--chart-3)", type: "area", unit: "kWh", digits: 0 },
                  { key: "sec", label: "Specific energy", color: "var(--chart-1)", axis: "right", unit: "kWh/kg", digits: 3 },
                ]}
                height={210}
              />
            </div>
          </Panel>
        )}
        {canView(user.role, "gas") && (
          <Panel title="Unaccounted-for gas" description="Input minus metered sales and linepack change, by zone" actions={<Link href={link("/gas")} className="btn">Open gas balance</Link>} evidence={o.gas.evidence}>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Network UAG" value={pct(o.gas.uagPct, 2)} tone={o.gas.uagPct > 1.2 ? "crit" : "ok"} sub={`${num(o.gas.uagScm)} SCM`} />
              <Stat label="Gas input" value={num(o.gas.inputScm / 1e6, 2)} unit="MMSCM" />
            </div>
            <div className="mt-5">
              <RankBars
                rows={o.gas.zones.map((z) => ({ key: z.zoneId, label: z.zoneName, value: z.uagPct, tone: z.uagPct > 1.2 ? "crit" : "flow" }))}
                format={(v) => pct(v, 2)}
                reference={{ value: 1.2, label: "1.2% alert limit" }}
              />
              <p className="mt-2 text-[12px] text-ink-3">Vertical rule marks the 1.2% alert limit.</p>
            </div>
          </Panel>
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Panel title="Domain status" description="Headline position for each intelligence domain in your scope" bodyClass="p-0">
          <ul>
            {visibleBoard.map((b) => (
              <li key={b.domain} className="border-b border-line-2 last:border-b-0">
                <Link href={link(b.href)} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
                  <span className="font-semibold text-ink">{b.domain}</span>
                  <span className="order-3 col-span-2 min-w-0 sm:order-none sm:col-span-1">
                    <span className="font-display tabular text-[18px] font-semibold text-ink">{b.headline}</span>
                    <span className="ml-2 text-[12.5px] text-ink-2">{b.detail}</span>
                  </span>
                  <span className="text-right">
                    <Tag tone={b.tone}>{b.state}</Tag>
                  </span>
                  <span className="order-4 col-span-2 text-[11.5px] text-ink-3 sm:col-span-3 sm:col-start-2">
                    <QualityPip quality={b.evidence.quality} /> <span className="ml-1.5">{b.evidence.sources.join(" + ")}, {b.evidence.version}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        {canView(user.role, "alerts") ? (
          <Panel title="Needs attention" description={`${alerts.length} open alert${alerts.length === 1 ? "" : "s"} in scope`} actions={<Link href={link("/alerts")} className="btn">All alerts</Link>} bodyClass="p-0">
            {alerts.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-ink-2">No open alerts in this scope.</p>
            ) : (
              <ul>
                {alerts.slice(0, 7).map((a) => (
                  <li key={a.id} className="border-b border-line-2 px-4 py-2.5 last:border-b-0">
                    <div className="flex items-start gap-2">
                      <SeverityTag severity={a.severity} />
                      <Link href={`/alerts?focus=${a.id}`} className="min-w-0 flex-1 text-[13.5px] font-medium text-ink hover:underline">
                        {a.title}
                      </Link>
                    </div>
                    <p className="mt-0.5 pl-0.5 text-[12px] text-ink-3">
                      Routed to {a.routeRole.replace("_", " ")}, raised {ago(a.createdAt)}
                      {a.routeRole === user.role && <span className="ml-1.5 font-semibold text-brand">Your queue</span>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : (
          <Panel title="Safety and integrity" evidence={o.safety.evidence}>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="CP compliance" value={pct(o.safety.cpCompliancePct)} />
              <Stat label="Patrol coverage, 7 days" value={pct(o.safety.patrolCoveragePct, 0)} />
            </div>
          </Panel>
        )}
      </div>

      {canView(user.role, "opportunities") && (
        <Panel
          className="mt-4"
          title="Opportunity register"
          description="Largest opportunities identified by the agents. Values stay indicative until validated in the ATGL study."
          actions={<Link href={link("/opportunities")} className="btn">Open register</Link>}
          bodyClass="p-0"
        >
          <div className="flex flex-wrap gap-8 border-b border-line-2 px-4 py-3">
            <Stat label="Indicative value" value={inr(indicative)} indicative />
            <Stat label="Validated value" value={inr(validated)} tone={validated ? "ok" : undefined} sub={`${opps.filter((x) => x.validation === "validated").length} validated of ${opps.length}`} />
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Domain</th>
                <th className="num">Value per year</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {opps.slice(0, 6).map((x) => (
                <tr key={x.id}>
                  <td className="max-w-[520px]">
                    <Link href={`/opportunities?focus=${x.id}`} className="font-medium text-ink hover:underline">
                      {x.title}
                    </Link>
                  </td>
                  <td className="text-ink-2">{x.domain}</td>
                  <td className="num font-semibold">
                    {inr(x.validation === "validated" ? x.validatedValueInr : x.impactInr)}{" "}
                    <span className="font-normal text-ink-3">{x.validation}</span>
                  </td>
                  <td>
                    <Tag>{x.status.replace("-", " ")}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {opps[0] && (
            <div className="border-t border-line-2 px-4 py-2">
              <EvidenceStrip evidence={opps[0].evidence} />
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
