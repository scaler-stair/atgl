import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { EvidenceStrip, SeverityTag, Tag } from "@/components/ui";
import { billingKindLabel, billingSummary } from "@/lib/analytics/billing";
import { buildEvidence, CALC, resolveWindow, scopeLabel, WINDOWS } from "@/lib/analytics/common";
import { energySummary } from "@/lib/analytics/energy";
import { meteringSummary } from "@/lib/analytics/metering";
import { overview } from "@/lib/analytics/overview";
import { reliabilitySummary } from "@/lib/analytics/reliability";
import { safetySummary } from "@/lib/analytics/safety";
import { can, canView, ROLE_LABEL } from "@/lib/auth/rbac";
import { config } from "@/lib/config";
import { siteById } from "@/lib/domain/master";
import type { Evidence } from "@/lib/domain/types";
import { dateTime, inr, num, pct, signed } from "@/lib/format";
import { audit } from "@/lib/server/audit";
import { pageContext, type SearchParams } from "@/lib/server/page";
import { listAlerts, listOpportunities } from "@/lib/server/workflow";
import { isReportType, REPORT_TYPES } from "../report-types";
import { PrintButton } from "./PrintButton";

export const metadata: Metadata = { title: "Printable report" };

function Section({ title, evidence, children }: { title: string; evidence?: Evidence; children: ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid-page">
      <h2 className="border-b border-line pb-1 font-display text-[17px] font-semibold text-ink">{title}</h2>
      <div className="mt-2.5 text-[13px] text-ink">{children}</div>
      {evidence && <EvidenceStrip evidence={evidence} className="mt-2.5 border-t border-line-2 pt-2" />}
    </section>
  );
}

function Figures({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[12px] text-ink-2">{k}</dt>
          <dd className="font-display tabular text-[19px] font-semibold leading-6 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ head, rows, numCols = [] }: { head: string[]; rows: ReactNode[][]; numCols?: number[] }) {
  if (rows.length === 0) return <p className="text-ink-2">None in scope.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="data-table text-[12.5px]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={numCols.includes(i) ? "num" : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className={numCols.includes(ci) ? "num" : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Generation timestamp in IST; kept outside the component so render stays pure. */
const generatedStamp = () =>
  new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export default async function PrintReportPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, scope, windowKey, filter, params } = await pageContext("reports", searchParams);
  if (!can(user.role, "report.generate")) redirect("/denied?module=reports");
  const type = params.type;
  if (!isReportType(type)) redirect("/reports");
  const def = REPORT_TYPES.find((r) => r.key === type)!;
  const site = filter.site ? siteById.get(filter.site) : undefined;

  const generatedAt = generatedStamp();
  await audit({
    actorId: user.id,
    actorName: user.displayName,
    action: "report.generate",
    targetType: "report",
    targetId: type,
    after: { scope: filter, window: windowKey },
  });

  const envLabel = `${config.appEnv === "production" ? "Production" : config.appEnv === "staging" ? "Staging" : "Development"}, ${config.dataMode} data`;
  const show = {
    energy: canView(user.role, "energy"),
    gas: canView(user.role, "gas"),
    metering: canView(user.role, "metering"),
    reliability: canView(user.role, "reliability"),
    billing: canView(user.role, "billing"),
    vendors: canView(user.role, "vendors"),
    safety: canView(user.role, "safety"),
    alerts: canView(user.role, "alerts"),
    opportunities: canView(user.role, "opportunities"),
  };
  const backQs = new URLSearchParams(Object.entries({ ...filter, window: windowKey }).filter(([, v]) => v) as [string, string][]).toString();

  // Register and alert totals come from the workflow store; they carry the register's own evidence block.
  const workflowEvidence = buildEvidence({ scope, window: resolveWindow(windowKey), sources: ["MASTER"], version: CALC.opportunity, notes: ["Alert and opportunity counts are read from the workflow register at generation time."] });

  let body: ReactNode = null;

  if (type === "management") {
    const o = overview(scope, windowKey);
    const alerts = show.alerts ? await listAlerts(user, { ...filter, status: "open" }) : [];
    const opps = show.opportunities ? await listOpportunities(user, filter) : [];
    const indicative = opps.filter((x) => x.validation === "indicative" && x.status !== "rejected").reduce((t, x) => t + x.impactInr, 0);
    const validated = opps.filter((x) => x.validation === "validated" && x.status !== "rejected").reduce((t, x) => t + (x.validatedValueInr ?? 0), 0);
    body = (
      <>
        {show.energy && (
          <Section title="Compression energy" evidence={o.energy.evidence}>
            <Figures
              items={[
                ["Specific energy", `${num(o.energy.networkSec, 3)} kWh/kg`],
                ["Best-quartile benchmark", `${num(o.energy.benchmarkSec, 3)} kWh/kg`],
                ["Electricity", `${num(o.energy.totalKwh / 1000, 1)} MWh`],
                ["Excess over benchmark (indicative)", inr(o.energy.excessInr)],
              ]}
            />
            {o.energy.worstSites.length > 0 && (
              <p className="mt-2.5 text-ink-2">
                Largest gaps to benchmark: {o.energy.worstSites.map((w) => `${w.siteName} (${signed(w.gapPct, 1)})`).join(", ")}.
              </p>
            )}
          </Section>
        )}
        {show.gas && (
          <Section title="Gas balance and unaccounted-for gas" evidence={o.gas.evidence}>
            <Figures
              items={[
                ["Network UAG", pct(o.gas.uagPct, 2)],
                ["UAG volume", `${num(o.gas.uagScm)} SCM`],
                ["UAG value at gas cost", inr(o.gas.uagValueInr)],
                ["Gas input", `${num(o.gas.inputScm / 1e6, 2)} MMSCM`],
              ]}
            />
            <p className="mt-2.5 text-ink-2">By zone: {o.gas.zones.map((z) => `${z.zoneName} ${pct(z.uagPct, 2)}`).join(", ")}.</p>
          </Section>
        )}
        {show.metering && (
          <Section title="Metering" evidence={o.metering.evidence}>
            <Figures
              items={[
                ["Meters in fault", num(o.metering.counts.fault)],
                ["Meters on watch", num(o.metering.counts.watch)],
                ["Meters healthy", num(o.metering.counts.ok)],
                ["Revenue exposure per day (indicative)", inr(o.metering.exposureInrPerDay)],
              ]}
            />
          </Section>
        )}
        {show.reliability && (
          <Section title="Asset reliability" evidence={o.reliability.evidence}>
            <Figures
              items={[
                ["In alert", num(o.reliability.counts.alert)],
                ["On watch", num(o.reliability.counts.watch)],
                ["Healthy", num(o.reliability.counts.healthy)],
              ]}
            />
            {o.reliability.worst.length > 0 && (
              <p className="mt-2.5 text-ink-2">Lowest health: {o.reliability.worst.map((a) => `${a.siteName}, ${a.name} (${a.health}/100)`).join("; ")}.</p>
            )}
          </Section>
        )}
        {show.billing && (
          <Section title="Billing assurance" evidence={o.billing.evidence}>
            <Figures
              items={[
                ["Exceptions pending review", num(o.billing.exceptions)],
                ["Amount at stake (indicative)", inr(o.billing.atStakeInr)],
              ]}
            />
          </Section>
        )}
        {show.vendors && (
          <Section title="Vendors and AMC" evidence={o.vendor.evidence}>
            <Figures
              items={[
                ["Contracts in scope", num(o.vendor.total)],
                ["SLA breach", num(o.vendor.breach)],
                ["At risk", num(o.vendor.atRisk)],
              ]}
            />
          </Section>
        )}
        {show.safety && (
          <Section title="Safety and integrity" evidence={o.safety.evidence}>
            <Figures
              items={[
                ["CP compliance", pct(o.safety.cpCompliancePct)],
                ["Open high-severity events", num(o.safety.openHighEvents)],
                ["Unpermitted excavations", num(o.safety.unpermittedExcavations)],
                ["Patrol coverage, 7 days", pct(o.safety.patrolCoveragePct, 0)],
              ]}
            />
          </Section>
        )}
        {(show.alerts || show.opportunities) && (
          <Section title="Workflow position" evidence={workflowEvidence}>
            <Figures
              items={[
                ...(show.alerts
                  ? ([
                      ["Open alerts", num(alerts.length)],
                      ["Critical or high", num(alerts.filter((a) => a.severity === "critical" || a.severity === "high").length)],
                    ] as [string, ReactNode][])
                  : []),
                ...(show.opportunities
                  ? ([
                      ["Opportunities, indicative value", inr(indicative)],
                      ["Validated value", inr(validated)],
                    ] as [string, ReactNode][])
                  : []),
              ]}
            />
          </Section>
        )}
      </>
    );
  } else if (type === "exceptions") {
    const alerts = show.alerts ? await listAlerts(user, { ...filter, status: "open" }) : [];
    const billing = show.billing ? billingSummary(scope, windowKey) : null;
    const metering = show.metering ? meteringSummary(scope, windowKey) : null;
    const faults = metering ? metering.meters.filter((m) => m.status === "fault") : [];
    body = (
      <>
        {show.alerts && (
          <Section title={`Open alerts (${alerts.length})`} evidence={alerts[0]?.evidence}>
            <Table
              head={["Severity", "Alert", "Domain", "Routed to", "Raised"]}
              rows={alerts.map((a) => [<SeverityTag key="s" severity={a.severity} />, a.title, a.domain, a.routeRole.replace("_", " "), dateTime(a.createdAt)])}
            />
          </Section>
        )}
        {billing && (
          <Section title={`Billing exceptions awaiting review (${billing.exceptions.length})`} evidence={billing.evidence}>
            <p className="mb-2 text-ink-2">Total at stake {inr(billing.atStakeInr)} (indicative). Exceptions require review before any financial action; source documents retained.</p>
            <Table
              head={["Exception", "Site", "Month", "Detail", "At stake", "Source document"]}
              numCols={[4]}
              rows={billing.exceptions.map((e) => [billingKindLabel(e.kind), e.siteName, e.month, e.detail, inr(e.amountAtStakeInr), e.documentRef])}
            />
          </Section>
        )}
        {metering && (
          <Section title={`Meters in fault (${faults.length})`} evidence={metering.evidence}>
            <Table
              head={["Meter", "Site", "Drift", "Reasons", "Exposure per day"]}
              numCols={[2, 4]}
              rows={faults.map((m) => [m.meterId, m.siteName, signed(m.driftPct, 2), m.reasons.join("; "), inr(m.exposureInrPerDay)])}
            />
          </Section>
        )}
      </>
    );
  } else if (type === "site") {
    if (!site) {
      body = (
        <Section title="Site not selected">
          <p className="text-ink-2">
            A site report needs a site. <Link href="/reports" className="font-semibold text-brand underline">Go back to reports</Link> and choose a site in the scope bar.
          </p>
        </Section>
      );
    } else {
      const energy = show.energy ? energySummary(scope, windowKey) : null;
      const siteEnergy = energy?.sites.find((x) => x.siteId === site.id);
      const metering = show.metering ? meteringSummary(scope, windowKey) : null;
      const rel = show.reliability ? reliabilitySummary(scope, windowKey) : null;
      const billing = show.billing ? billingSummary(scope, windowKey) : null;
      const safety = show.safety ? safetySummary(scope, windowKey) : null;
      const alerts = show.alerts ? await listAlerts(user, { ...filter, status: "open" }) : [];
      body = (
        <>
          {energy && (
            <Section title="Energy" evidence={energy.evidence}>
              {siteEnergy ? (
                <Figures
                  items={[
                    ["Electricity", `${num(siteEnergy.totalKwh)} kWh`],
                    ["Specific energy", siteEnergy.secKwhPerKg === null ? "n/a" : `${num(siteEnergy.secKwhPerKg, 3)} kWh/kg`],
                    ["Gap to benchmark", signed(siteEnergy.benchmarkGapPct, 1)],
                    ["Excess energy", `${num(siteEnergy.excessKwh)} kWh`],
                  ]}
                />
              ) : (
                <p className="text-ink-2">No compression energy recorded for this site.</p>
              )}
            </Section>
          )}
          {metering && (
            <Section title="Meters" evidence={metering.evidence}>
              <Table
                head={["Meter", "Role", "Status", "Drift", "Calibration age", "Notes"]}
                numCols={[3, 4]}
                rows={metering.meters.map((m) => [
                  m.meterId,
                  m.role,
                  <Tag key="t" tone={m.status === "fault" ? "crit" : m.status === "watch" ? "warn" : "ok"}>
                    {m.status === "ok" ? "Healthy" : m.status === "watch" ? "Watch" : "Fault"}
                  </Tag>,
                  signed(m.driftPct, 2),
                  `${num(m.calibrationAgeDays)} days`,
                  m.reasons.join("; ") || "None",
                ])}
              />
            </Section>
          )}
          {rel && (
            <Section title="Asset health" evidence={rel.evidence}>
              <Table
                head={["Asset", "Class", "Health", "State", "Open work orders", "Findings"]}
                numCols={[2, 4]}
                rows={rel.assets.map((a) => [a.name, a.cls, `${a.health}/100`, a.state, num(a.openWorkOrders), a.findings.join("; ") || "None"])}
              />
            </Section>
          )}
          {billing && (
            <Section title="Electricity bills" evidence={billing.evidence}>
              <Table
                head={["Month", "Measured kWh", "Billed kWh", "Variance", "Billed", "Expected", "Exceptions"]}
                numCols={[1, 2, 3, 4, 5, 6]}
                rows={billing.bills.map((b) => [
                  b.month,
                  num(b.measuredKwh),
                  num(b.billedKwh),
                  signed(b.variancePct, 2),
                  inr(b.billedAmountInr),
                  inr(b.expectedAmountInr),
                  num(billing.exceptions.filter((e) => e.billNo === b.billNo).length),
                ])}
              />
            </Section>
          )}
          {safety && (
            <Section title="Zone safety context" evidence={safety.evidence}>
              <Figures
                items={[
                  ["CP compliance", pct(safety.cpCompliancePct)],
                  ["Open high-severity events", num(safety.openHighEvents)],
                  ["Unpermitted excavations", num(safety.unpermittedExcavations)],
                ]}
              />
            </Section>
          )}
          {show.alerts && (
            <Section title={`Open alerts (${alerts.length})`} evidence={alerts[0]?.evidence}>
              <Table
                head={["Severity", "Alert", "Routed to", "Raised"]}
                rows={alerts.map((a) => [<SeverityTag key="s" severity={a.severity} />, a.title, a.routeRole.replace("_", " "), dateTime(a.createdAt)])}
              />
            </Section>
          )}
        </>
      );
    }
  } else {
    const opps = show.opportunities ? await listOpportunities(user, filter) : [];
    const live = opps.filter((x) => x.status !== "rejected");
    const indicative = live.filter((x) => x.validation === "indicative").reduce((t, x) => t + x.impactInr, 0);
    const validated = live.filter((x) => x.validation === "validated").reduce((t, x) => t + (x.validatedValueInr ?? 0), 0);
    body = show.opportunities ? (
      <>
        <Section title="Register totals" evidence={workflowEvidence}>
          <Figures
            items={[
              ["Opportunities", num(opps.length)],
              ["Indicative value per year", inr(indicative)],
              ["Validated value per year", inr(validated)],
              ["Validated", `${live.filter((x) => x.validation === "validated").length} of ${live.length}`],
            ]}
          />
          <p className="mt-2.5 text-ink-2">Indicative values stay indicative until validated in the ATGL study and an approved business case.</p>
        </Section>
        {opps.map((x) => (
          <Section key={x.id} title={x.title} evidence={x.evidence}>
            <Figures
              items={[
                [x.validation === "validated" ? "Validated value per year" : "Indicative value per year", inr(x.validation === "validated" ? x.validatedValueInr : x.impactInr)],
                ["Domain", x.domain],
                ["Status", x.status.replace("-", " ")],
                ["Owner", x.ownerName ?? "Unassigned"],
              ]}
            />
            <p className="mt-2.5 text-ink-2">
              <span className="font-semibold text-ink">Recommendation: </span>
              {x.recommendation}
            </p>
            <p className="mt-1 text-[12px] text-ink-3">Basis: {x.impactBasis}</p>
          </Section>
        ))}
      </>
    ) : (
      <Section title="Not available">
        <p className="text-ink-2">Your role does not include the opportunity register.</p>
      </Section>
    );
  }

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={backQs ? `/reports?${backQs}` : "/reports"} className="btn">
          Back to reports
        </Link>
        <PrintButton />
      </div>

      <article className="print-sheet rounded-lg border border-line bg-surface px-5 py-6 shadow-sm sm:px-10 sm:py-9">
        <header className="border-b-2 border-ink pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-brand">{config.tenantName}, energy and gas intelligence</p>
              <h1 className="mt-1 font-display text-[28px] font-semibold leading-8 tracking-tight text-ink">
                {def.title}
                {type === "site" && site ? `: ${site.name}` : ""}
              </h1>
            </div>
            <span className="rounded border-2 border-warn px-2.5 py-1 font-display text-[14px] font-semibold text-warn">{envLabel}</span>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
            {(
              [
                ["Scope", scopeLabel(scope)],
                ["Window", WINDOWS[windowKey].label],
                ["Generated", `${generatedAt} IST`],
                ["Generated by", `${user.displayName} (${ROLE_LABEL[user.role]})`],
                ["Environment", `${envLabel}${config.appEnv !== "production" || config.dataMode !== "live" ? ". Not for operational or financial decisions." : ""}`],
                ["Tenant", config.tenantName],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-24 shrink-0 text-ink-3">{k}</dt>
                <dd className="min-w-0 text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </header>

        {body}

        <footer className="mt-8 border-t border-line pt-3 text-[11.5px] text-ink-3">
          Read-only intelligence output. Figures carry their evidence (quality, window, sources, freshness and calculation version). Rupee values are indicative unless marked validated. Generation of this report is recorded in the audit log.
        </footer>
      </article>
    </div>
  );
}
