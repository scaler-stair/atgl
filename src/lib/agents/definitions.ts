import { billingKindLabel, billingSummary, type BillingException, type BillingExceptionKind } from "../analytics/billing";
import { ASSUMPTIONS, CALC, round } from "../analytics/common";
import { energySummary } from "../analytics/energy";
import { gasSummary } from "../analytics/gas";
import { meteringSummary } from "../analytics/metering";
import { reliabilitySummary } from "../analytics/reliability";
import { safetySummary } from "../analytics/safety";
import { vendorSummary } from "../analytics/vendor";
import { connectorStatuses, historian } from "../connectors";
import { anchorHour, DAY, HOUR } from "../connectors/synthetic";
import { assets, siteById } from "../domain/master";
import type { Evidence, Scope } from "../domain/types";
import type { Role } from "../auth/rbac";

/**
 * AI agent registry (Section 4). Agents are deterministic, versioned rule and
 * model pipelines over read-only data. They emit findings that become alerts,
 * opportunities or data-quality issues; an LLM is used only to narrate
 * findings (never to invent them) and for the interactive Executive Copilot.
 */

export type Severity = "critical" | "high" | "medium" | "low";
export type Domain = "data-quality" | "energy" | "gas" | "metering" | "reliability" | "billing" | "vendor" | "safety";

export interface Finding {
  key: string;
  domain: Domain;
  severity: Severity;
  title: string;
  detail: string;
  siteId?: string;
  zoneId?: string;
  evidence: Evidence;
  alert?: { routeRole: Role };
  opportunity?: { impactInr: number; basis: string; recommendation: string; ownerRole: Role };
  dq?: { source: string; entity: string; kind: string };
}

export interface AgentOutput {
  summary: string;
  findings: Finding[];
}

export interface AgentDefinition {
  id: string;
  order: number;
  name: string;
  version: string;
  responsibility: string;
  guardrail: string;
  domains: Domain[];
  interactive?: boolean;
  run?: () => AgentOutput;
}

const TENANT: Scope = { allowedSiteIds: null };
const zoneOf = (siteId: string) => siteById.get(siteId)?.zoneId;
const inr = (v: number) => `₹${round(v / 1e5, 2).toLocaleString("en-IN")} lakh`;

function dataQualityAgent(): AgentOutput {
  const anchor = anchorHour();
  const findings: Finding[] = [];
  const statuses = connectorStatuses();
  const baseEvidence = (sources: Evidence["sources"], version = "dq-rules@1.1.0"): Evidence => ({
    window: { key: "24h", from: new Date(anchor - 23 * HOUR).toISOString(), to: new Date(anchor).toISOString(), label: "Last 24 hours" },
    sources,
    quality: "degraded",
    asOf: new Date().toISOString(),
    version,
    scopeLabel: "All zones",
  });
  for (const s of statuses) {
    if (s.lagMinutes > s.expectedFreshnessMin || s.state !== "healthy") {
      findings.push({
        key: `dq:connector:${s.id}`,
        domain: "data-quality",
        severity: s.state === "failed" ? "critical" : "high",
        title: `${s.name} feed ${s.state}`,
        detail: s.message ?? `Last good sample ${s.lagMinutes} min ago; expected within ${s.expectedFreshnessMin} min.`,
        evidence: baseEvidence([s.system]),
        alert: { routeRole: "security" },
        dq: { source: s.id, entity: s.id, kind: "source-failure" },
      });
    }
  }
  // Timestamp gaps in compressor series over the last 3 days.
  for (const a of assets.filter((x) => x.cls === "compressor")) {
    const series = historian.read.getCompressorSeries(a.id, anchor - 3 * DAY, anchor, anchor);
    const gaps = series.filter((s) => s.flag === "gap").length;
    const expected = 3 * 24 + 1;
    if (gaps > 0) {
      findings.push({
        key: `dq:gap:${a.id}`,
        domain: "data-quality",
        severity: "medium",
        title: `${gaps}-hour gap in ${a.id} telemetry`,
        detail: `Historian returned null/zero frames for ${gaps} consecutive hours. Energy totals for affected windows exclude the gap; no backfill without provenance (SOP-03).`,
        siteId: a.siteId,
        zoneId: zoneOf(a.siteId),
        evidence: baseEvidence(["HISTORIAN"]),
        dq: { source: "scada-historian", entity: a.id, kind: "timestamp-gap" },
      });
    } else if (series.length < expected - 1) {
      findings.push({
        key: `dq:stale:${a.siteId}`,
        domain: "data-quality",
        severity: "high",
        title: `Stale telemetry at ${a.siteId}`,
        detail: `${expected - series.length} hourly samples missing at end of series; site RTU not reporting.`,
        siteId: a.siteId,
        zoneId: zoneOf(a.siteId),
        evidence: { ...baseEvidence(["RTU"]), quality: "stale" },
        alert: { routeRole: "operations" },
        dq: { source: "rtu-ot", entity: a.siteId, kind: "stale" },
      });
    }
  }
  const metering = meteringSummary(TENANT, "24h");
  for (const m of metering.meters.filter((x) => x.unitMismatch)) {
    findings.push({
      key: `dq:unit:${m.meterId}`,
      domain: "data-quality",
      severity: "medium",
      title: `Unit mismatch on ${m.meterId}`,
      detail: `${m.unitMismatch}. Values held out of pressure-corrected calculations until the tag dictionary is confirmed.`,
      siteId: m.siteId,
      zoneId: zoneOf(m.siteId),
      evidence: baseEvidence(["RTU", "MASTER"]),
      dq: { source: "rtu-ot", entity: m.meterId, kind: "unit-mismatch" },
    });
  }
  const dedup = new Map(findings.map((f) => [f.key, f]));
  const list = [...dedup.values()];
  return { summary: `${list.length} data-quality issue(s) across ${statuses.length} sources; ${statuses.filter((s) => s.state !== "healthy").length} source(s) degraded.`, findings: list };
}

function energyAgent(): AgentOutput {
  const e = energySummary(TENANT, "7d");
  const findings: Finding[] = [];
  for (const s of e.sites.filter((x) => (x.benchmarkGapPct ?? 0) > 10)) {
    const annualKwh = s.excessKwh * 52;
    const worstCmp = e.compressors.filter((c) => c.siteId === s.siteId).sort((a, b) => (b.secKwhPerKg ?? 0) - (a.secKwhPerKg ?? 0))[0];
    const lowSuction = worstCmp?.avgSuctionBar !== null && (worstCmp?.avgSuctionBar ?? 99) < 16;
    findings.push({
      key: `energy:sec:${s.siteId}`,
      domain: "energy",
      severity: (s.benchmarkGapPct ?? 0) > 20 ? "high" : "medium",
      title: `${s.siteName}: specific energy ${s.benchmarkGapPct}% above benchmark`,
      detail: `SEC ${s.secKwhPerKg} kWh/kg vs best-quartile ${e.benchmarkSec} kWh/kg over 7 days; ${s.excessKwh.toLocaleString("en-IN")} kWh excess.${worstCmp ? ` Worst unit ${worstCmp.name} at ${worstCmp.secKwhPerKg} kWh/kg, mean suction ${worstCmp.avgSuctionBar ?? "n/a"} bar.` : ""}${lowSuction ? " Low suction pressure indicates network pressure starvation upstream." : ""}`,
      siteId: s.siteId,
      zoneId: s.zoneId,
      evidence: { ...e.evidence, scopeLabel: s.siteName },
      alert: (s.benchmarkGapPct ?? 0) > 20 ? { routeRole: "operations" } : undefined,
      opportunity: {
        impactInr: round(annualKwh * ASSUMPTIONS.energyRateInrPerKwh),
        basis: `${annualKwh.toLocaleString("en-IN")} kWh/yr (7-day excess × 52) at ₹${ASSUMPTIONS.energyRateInrPerKwh}/kWh; ${CALC.energySec}`,
        recommendation: lowSuction
          ? "Review inlet pressure regime with gas control; evaluate suction pressure set-point and lead/lag staging."
          : "Inspect compressor valves/rings and staging logic; compare with best-quartile station operating envelope.",
        ownerRole: "operations",
      },
    });
  }
  // Unit-level outliers: compressors >12% above the fleet median SEC for their class.
  const secs = e.compressors.map((c) => c.secKwhPerKg).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const median = secs[Math.floor(secs.length / 2)];
  for (const c of e.compressors) {
    if (c.secKwhPerKg === null || !median || c.secKwhPerKg < median * 1.12) continue;
    if (findings.some((f) => f.siteId === c.siteId)) continue;
    const gap = round(((c.secKwhPerKg - median) / median) * 100, 1);
    const annualKwh = round((c.secKwhPerKg - median) * c.kg * 52);
    findings.push({
      key: `energy:unit:${c.assetId}`,
      domain: "energy",
      severity: gap > 15 ? "high" : "medium",
      title: `${c.siteName}: ${c.name} specific energy ${gap}% above fleet median`,
      detail: `${c.assetId} at ${c.secKwhPerKg} kWh/kg vs fleet median ${median} kWh/kg over 7 days (${c.runHours} run hours, mean suction ${c.avgSuctionBar ?? "n/a"} bar). Normal suction points to internal efficiency loss (valves, rings, cooler fouling).`,
      siteId: c.siteId,
      zoneId: zoneOf(c.siteId),
      evidence: { ...e.evidence, scopeLabel: c.assetId },
      opportunity: {
        impactInr: round(annualKwh * ASSUMPTIONS.energyRateInrPerKwh),
        basis: `${annualKwh.toLocaleString("en-IN")} kWh/yr above fleet median at ₹${ASSUMPTIONS.energyRateInrPerKwh}/kWh; ${CALC.energySec}`,
        recommendation: "Performance test the unit; inspect valves, rings and inter-stage coolers; cross-check with reliability findings.",
        ownerRole: "engineering",
      },
    });
  }
  return { summary: `Network SEC ${e.networkSec} kWh/kg vs benchmark ${e.benchmarkSec}; ${findings.length} station(s) above threshold, indicative excess ${inr(e.excessInr * 52)}/yr.`, findings };
}

function gasAgent(): AgentOutput {
  const g = gasSummary(TENANT, "7d");
  const findings: Finding[] = [];
  const target = 1.0;
  for (const z of g.zones.filter((x) => x.uagPct > 1.2)) {
    const a = z.attribution;
    const parts = Object.entries(a).sort((x, y) => y[1] - x[1]);
    const recoverable = z.uagScm - (z.inputScm * target) / 100;
    findings.push({
      key: `gas:uag:${z.zoneId}`,
      domain: "gas",
      severity: z.uagPct > 2 ? "high" : "medium",
      title: `${z.zoneName} UAG ${z.uagPct}% over 7 days`,
      detail: `Input ${z.inputScm.toLocaleString("en-IN")} SCM, UAG ${z.uagScm.toLocaleString("en-IN")} SCM. Attribution: ${parts.map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${round((v / z.uagScm) * 100)}%`).join(", ")}. Contributing measures: fiscal inlet meter, district and industrial meters, linepack Δ ${z.deltaLinepackScm.toLocaleString("en-IN")} SCM.`,
      zoneId: z.zoneId,
      evidence: { ...g.evidence, scopeLabel: `${z.zoneName} zone`, notes: g.assumptions },
      alert: { routeRole: "operations" },
      opportunity: {
        impactInr: round(Math.max(0, recoverable) * 52 * ASSUMPTIONS.gasCostInrPerScm),
        basis: `Reduce UAG from ${z.uagPct}% to ${target}% target: ${round(Math.max(0, recoverable) * 52).toLocaleString("en-IN")} SCM/yr at ₹${ASSUMPTIONS.gasCostInrPerScm}/SCM`,
        recommendation: "Verify drifting industrial meters against check meter, close open leak-survey findings, and reconcile domestic billing lag.",
        ownerRole: "operations",
      },
    });
  }
  return { summary: `Network UAG ${g.uagPct}% (${g.uagScm.toLocaleString("en-IN")} SCM, 7 days); ${findings.length} zone(s) above 1.2%.`, findings };
}

function reliabilityAgent(): AgentOutput {
  const r = reliabilitySummary(TENANT, "7d");
  const findings: Finding[] = [];
  for (const a of r.assets.filter((x) => x.state !== "healthy" && x.findings.length)) {
    const alert = a.state === "alert";
    findings.push({
      key: `rel:${a.assetId}`,
      domain: "reliability",
      severity: alert ? (a.criticality === "A" ? "high" : "medium") : "low",
      title: `${a.siteName}: ${a.name} health ${a.health}/100`,
      detail: `${a.findings.join(". ")}. Confidence ${Math.round(a.confidence * 100)}%, model ${a.modelVersion}. Advisory only.`,
      siteId: a.siteId,
      zoneId: zoneOf(a.siteId),
      evidence: { ...r.evidence, scopeLabel: `${a.assetId}` },
      alert: alert ? { routeRole: "engineering" } : undefined,
      opportunity:
        alert && a.cls === "compressor"
          ? {
              impactInr: 1_450_000,
              basis: "Avoided unplanned outage: 5 days × ₹2.9 lakh/day lost CNG margin at mother station (indicative)",
              recommendation: "Schedule condition inspection (bearing, alignment, valve analysis) within 72 h; plan outage in low-demand window.",
              ownerRole: "engineering",
            }
          : undefined,
    });
  }
  return { summary: `${r.counts.alert} asset(s) in alert, ${r.counts.watch} on watch of ${r.assets.length} monitored.`, findings };
}

const BILLING_RECOMMENDATION: Record<BillingExceptionKind, string> = {
  "energy-variance": "Raise meter-reading dispute with Discom citing check-meter data; request joint meter inspection.",
  "demand-exceedance": "Evaluate contract demand revision vs load scheduling of compressor start-ups.",
  "power-factor": "Inspect APFC panel and capacitor banks; restore PF above 0.95.",
  "tariff-category": "Submit tariff re-categorisation request with connection documents; claim refund of differential.",
};

function billingAgent(): AgentOutput {
  const b = billingSummary(TENANT, "30d");
  // One finding per site and exception type; months and bills listed as evidence.
  const groups = new Map<string, BillingException[]>();
  for (const x of b.exceptions) groups.set(`${x.siteId}:${x.kind}`, [...(groups.get(`${x.siteId}:${x.kind}`) ?? []), x]);
  const findings: Finding[] = [...groups.entries()].map(([k, xs]) => {
    const first = xs[0];
    const total = xs.reduce((t, x) => t + x.amountAtStakeInr, 0);
    const recurring = first.kind !== "energy-variance";
    const annual = recurring ? (total / xs.length) * 12 : total;
    const months = xs.map((x) => x.month).sort();
    return {
      key: `bill:${k}`,
      domain: "billing" as const,
      severity: total > 150_000 ? ("high" as const) : ("medium" as const),
      title: `${first.siteName}: ${billingKindLabel(first.kind).toLowerCase()} (${months.length} month${months.length > 1 ? "s" : ""})`,
      detail: `${xs.map((x) => `${x.month}: ${x.detail}`).join(" | ")}. Bills ${xs.map((x) => x.billNo).join(", ")}; source documents retained. Requires review before any financial action.`,
      siteId: first.siteId,
      zoneId: zoneOf(first.siteId),
      evidence: { ...b.evidence, scopeLabel: first.siteName, notes: [...(b.evidence.notes ?? []), ...xs.map((x) => `Source: ${x.documentRef}`)] },
      alert: { routeRole: "finance" as Role },
      opportunity:
        total > 20_000
          ? {
              impactInr: round(annual),
              basis: recurring ? `Average monthly penalty ₹${round(total / xs.length).toLocaleString("en-IN")} × 12 (indicative)` : `Recovery claim for ${months.join(", ")} (indicative)`,
              recommendation: BILLING_RECOMMENDATION[first.kind],
              ownerRole: "finance" as Role,
            }
          : undefined,
    };
  });
  return { summary: `${b.exceptions.length} billing exception(s) across ${b.bills.length} bills (${findings.length} site issues); ${inr(b.atStakeInr)} at stake pending review.`, findings };
}

function safetyAgent(): AgentOutput {
  const s = safetySummary(TENANT, "7d");
  const findings: Finding[] = [];
  for (const seg of s.segments.filter((x) => x.failingTestPoints.length)) {
    findings.push({
      key: `safety:cp:${seg.segmentId}`,
      domain: "safety",
      severity: seg.failingTestPoints.length >= 2 ? "high" : "medium",
      title: `CP below criterion on ${seg.name}`,
      detail: `${seg.failingTestPoints.length} test point(s) (${seg.failingTestPoints.join(", ")}) less negative than −0.85 V CSE; worst ${seg.worstPotentialV} V. Check rectifier output and coating defects (DCVG survey).`,
      zoneId: seg.zoneId,
      evidence: { ...s.evidence, scopeLabel: seg.name },
      alert: { routeRole: "engineering" },
    });
  }
  for (const e of s.events.filter((x) => x.status === "open" && (x.severity === "high" || (x.kind === "excavation" && x.permitted === false)))) {
    findings.push({
      key: `safety:event:${e.id}`,
      domain: "safety",
      severity: e.severity === "high" ? "critical" : "high",
      title: `${e.zoneName}: ${e.kind === "leak" ? "open leak finding" : e.kind === "excavation" ? "third-party excavation exposure" : e.kind}`,
      detail: `${e.description}. Route to emergency/patrol workflow; no automated operational action.`,
      zoneId: e.zoneId,
      evidence: { ...s.evidence, scopeLabel: e.segmentId },
      alert: { routeRole: "operations" },
    });
  }
  return { summary: `CP compliance ${s.cpCompliancePct}%; ${s.openHighEvents} open high-severity event(s); ${s.unpermittedExcavations} unpermitted excavation(s).`, findings };
}

function opportunityAgent(): AgentOutput {
  const m = meteringSummary(TENANT, "7d");
  const v = vendorSummary(TENANT, "30d");
  const findings: Finding[] = [];
  for (const row of m.meters.filter((x) => x.exposureInrPerDay > 1000)) {
    findings.push({
      key: `opp:meter:${row.meterId}`,
      domain: "metering",
      severity: row.status === "fault" ? "high" : "medium",
      title: `${row.meterId}${row.customer ? ` (${row.customer})` : ""}: under-registration ${row.driftPct}%`,
      detail: `${row.reasons.join("; ")}. Flow ${row.flowScmh.toLocaleString("en-IN")} SCMH; revenue exposure ${inr(row.exposureInrPerDay)}/day.`,
      siteId: row.siteId,
      zoneId: zoneOf(row.siteId),
      evidence: { ...m.evidence, scopeLabel: row.meterId },
      alert: row.status === "fault" ? { routeRole: "operations" } : undefined,
      opportunity: {
        impactInr: round(row.exposureInrPerDay * 365),
        basis: `Drift × flow × ₹${ASSUMPTIONS.industrialGasPriceInrPerScm}/SCM × 365; ${CALC.meterDrift}`,
        recommendation: "Proving run against master meter; recalibrate or replace; raise supplementary bill if contract permits.",
        ownerRole: "finance",
      },
    });
  }
  for (const c of v.vendors.filter((x) => x.status !== "on-track")) {
    findings.push({
      key: `opp:vendor:${c.id}`,
      domain: "vendor",
      severity: c.status === "breach" ? "medium" : "low",
      title: `${c.vendor}: ${c.flags[0] ?? c.status}`,
      detail: `${c.flags.join("; ")}. Average response ${c.avgResponseHours ?? "n/a"} h vs SLA ${c.slaResponseHours} h over ${c.workOrders} work orders.`,
      evidence: { ...v.evidence, scopeLabel: c.id },
      alert: c.daysToExpiry < 45 ? { routeRole: "operations" } : undefined,
      opportunity:
        c.status === "breach"
          ? {
              impactInr: round(c.annualValueInr * 0.05),
              basis: "SLA penalty clause at 5% of annual contract value (indicative, subject to contract terms)",
              recommendation: "Invoke SLA review with vendor; apply penalty clause; link payment release to response KPI.",
              ownerRole: "finance",
            }
          : undefined,
    });
  }
  return { summary: `${findings.filter((f) => f.opportunity).length} metering/vendor opportunities sized; all values indicative until validated.`, findings };
}

export const AGENTS: AgentDefinition[] = [
  { id: "data-quality", order: 1, name: "Data quality agent", version: "dq-agent@1.1.0", responsibility: "Detect missing/stale/outlier data, timestamp gaps, unit mismatches and source failures", guardrail: "Flags data-quality state; analytics surface freshness and quality rather than hide it", domains: ["data-quality"], run: dataQualityAgent },
  { id: "energy", order: 2, name: "Energy intelligence agent", version: "energy-agent@1.3.0", responsibility: "Analyse compressor/station energy patterns and benchmarking", guardrail: "Uses approved formulas; shows source period and calculation version", domains: ["energy"], run: energyAgent },
  { id: "gas-uag", order: 3, name: "Gas / UAG agent", version: "uag-agent@1.0.2", responsibility: "Analyse balances, UAG attribution and operational drivers", guardrail: "Never changes source data; every explanation links to contributing measures and assumptions", domains: ["gas"], run: gasAgent },
  { id: "reliability", order: 4, name: "Reliability agent", version: "reliability-agent@0.9.4", responsibility: "Surface asset-health anomalies and maintenance opportunities", guardrail: "Predictions remain advisory; shows model version, confidence and asset context", domains: ["reliability"], run: reliabilityAgent },
  { id: "billing", order: 5, name: "Billing assurance agent", version: "billing-agent@1.2.0", responsibility: "Reconcile measured consumption and billing data", guardrail: "Exceptions require review before financial action; source documents preserved", domains: ["billing"], run: billingAgent },
  { id: "safety", order: 6, name: "Safety / integrity agent", version: "safety-agent@1.0.1", responsibility: "Prioritise integrity and safety intelligence from approved feeds", guardrail: "No automated operational action; routes alerts to the responsible workflow", domains: ["safety"], run: safetyAgent },
  { id: "opportunity", order: 7, name: "Opportunity agent", version: "opportunity-agent@1.0.0", responsibility: "Convert signals into quantified opportunities and owners", guardrail: "Rupee values marked indicative until validated in the study / approved business case", domains: ["metering", "vendor"], run: opportunityAgent },
  { id: "copilot", order: 8, name: "Executive copilot", version: "copilot@1.0.0", responsibility: "Answer cross-domain questions and prepare reports", guardrail: "Grounded on approved data; includes time window, site scope, source lineage and calculation/model version", domains: [], interactive: true },
];

export const agentById = new Map(AGENTS.map((a) => [a.id, a]));
