import "server-only";
import { billingSummary } from "../analytics/billing";
import { parseWindow, round, scopeLabel } from "../analytics/common";
import { energySummary } from "../analytics/energy";
import { gasSummary } from "../analytics/gas";
import { meteringSummary } from "../analytics/metering";
import { overview } from "../analytics/overview";
import { reliabilitySummary } from "../analytics/reliability";
import { safetySummary } from "../analytics/safety";
import { vendorSummary } from "../analytics/vendor";
import { connectorStatuses } from "../connectors";
import { siteById, sites, siteTypeLabel, zones } from "../domain/master";
import type { Evidence, Scope } from "../domain/types";
import { listAlerts, listDqIssues, listOpportunities } from "../server/workflow";
import type { User } from "../server/users";

/**
 * Copilot tools: thin, read-only projections of the analytics layer. Every
 * result carries its evidence so the model can cite lineage, and every call
 * is executed inside the requesting user's site scope.
 */

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  evidence: Evidence | null;
  ok: boolean;
  error?: string;
}

type Args = Record<string, unknown>;
type ToolImpl = (args: Args, ctx: { user: User; base: Scope }) => { result: unknown; evidence: Evidence | null } | Promise<{ result: unknown; evidence: Evidence | null }>;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function scoped(ctx: { base: Scope }, args: Args): Scope {
  const zone = str(args.zone)?.toUpperCase();
  const site = str(args.site)?.toUpperCase();
  const s: Scope = { ...ctx.base };
  if (zone && zones.some((z) => z.id === zone)) s.zoneId = zone;
  if (site && siteById.has(site) && (!s.allowedSiteIds || s.allowedSiteIds.includes(site))) s.siteId = site;
  return s;
}

const windowParam = { type: "string", enum: ["24h", "7d", "30d"], description: "Time window. Default 7d." };
const zoneParam = { type: "string", description: "Zone ID: AHD (Ahmedabad), VAD (Vadodara), FBD (Faridabad), KHJ (Khurja), UDR (Udaipur)." };
const siteParam = { type: "string", description: "Canonical site ID, e.g. AHD-MS-01. Use list_sites to discover IDs." };

export const TOOL_DECLARATIONS = [
  { name: "list_sites", description: "List zones and sites (ID, name, type) visible to the user.", parametersJsonSchema: { type: "object", properties: { zone: zoneParam } } },
  { name: "get_overview", description: "Network-wide KPI snapshot across energy, gas/UAG, metering, reliability, billing, vendor and safety.", parametersJsonSchema: { type: "object", properties: { window: windowParam, zone: zoneParam, site: siteParam } } },
  { name: "get_energy", description: "Compressor and station energy: kWh, kg compressed, specific energy consumption (kWh/kg), benchmark gap, excess kWh.", parametersJsonSchema: { type: "object", properties: { window: windowParam, zone: zoneParam, site: siteParam } } },
  { name: "get_gas_balance", description: "Zone gas balance: input, outputs by category, linepack, UAG % and UAG attribution with assumptions; cascade inventory.", parametersJsonSchema: { type: "object", properties: { window: windowParam, zone: zoneParam } } },
  { name: "get_metering", description: "Meter health: drift vs check meter, calibration age, diagnostics, unit mismatches, revenue exposure.", parametersJsonSchema: { type: "object", properties: { zone: zoneParam, site: siteParam } } },
  { name: "get_asset_health", description: "Asset reliability: health score, state, findings, confidence and model version for compressors, motors, pumps, transformers, chillers.", parametersJsonSchema: { type: "object", properties: { zone: zoneParam, site: siteParam, asset_class: { type: "string", enum: ["compressor", "motor", "pump", "transformer", "chiller", "dispenser"] } } } },
  { name: "get_billing_exceptions", description: "Discom billing reconciliation: measured vs billed kWh, demand and PF penalties, tariff mismatches with source documents.", parametersJsonSchema: { type: "object", properties: { zone: zoneParam, site: siteParam } } },
  { name: "get_vendor_performance", description: "Vendor/AMC contracts: SLA compliance, response times, expiry, payments on hold.", parametersJsonSchema: { type: "object", properties: {} } },
  { name: "get_safety", description: "Safety and integrity: cathodic protection compliance, excavation exposure, leaks, patrol coverage.", parametersJsonSchema: { type: "object", properties: { window: windowParam, zone: zoneParam } } },
  { name: "get_opportunities", description: "Opportunity register: rupee impact (indicative or validated), status, owner, recommendation.", parametersJsonSchema: { type: "object", properties: { domain: { type: "string", enum: ["energy", "gas", "metering", "reliability", "billing", "vendor", "safety"] }, zone: zoneParam } } },
  { name: "get_alerts", description: "Alert queue by status and domain with routing role.", parametersJsonSchema: { type: "object", properties: { status: { type: "string", enum: ["open", "acknowledged", "closed", "all"] }, domain: { type: "string" } } } },
  { name: "get_data_quality", description: "Source connector freshness and open data-quality issues.", parametersJsonSchema: { type: "object", properties: {} } },
];

const IMPL: Record<string, ToolImpl> = {
  list_sites: (args, ctx) => {
    const s = scoped(ctx, args);
    return {
      result: sites
        .filter((x) => (!s.allowedSiteIds || s.allowedSiteIds.includes(x.id)) && (!s.zoneId || x.zoneId === s.zoneId))
        .map((x) => ({ id: x.id, name: x.name, zone: x.zoneId, type: siteTypeLabel[x.type] })),
      evidence: null,
    };
  },
  get_overview: (args, ctx) => {
    const o = overview(scoped(ctx, args), parseWindow(str(args.window)));
    return { result: o, evidence: o.energy.evidence };
  },
  get_energy: (args, ctx) => {
    const e = energySummary(scoped(ctx, args), parseWindow(str(args.window)));
    return {
      result: {
        totalKwh: e.totalKwh, compressionKwh: e.compressionKwh, auxKwh: e.auxKwh, kgCompressed: e.kgCompressed,
        networkSecKwhPerKg: e.networkSec, benchmarkSecKwhPerKg: e.benchmarkSec, excessKwh: e.excessKwh, excessInrIndicative: e.excessInr,
        stationsWorstFirst: e.sites.filter((x) => x.secKwhPerKg !== null).slice(0, 8),
        compressorsWorstFirst: e.compressors.slice(0, 6),
      },
      evidence: e.evidence,
    };
  },
  get_gas_balance: (args, ctx) => {
    const g = gasSummary(scoped(ctx, args), parseWindow(str(args.window)));
    return {
      result: { inputScm: g.inputScm, outputScm: g.outputScm, uagScm: g.uagScm, uagPct: g.uagPct, uagValueInrIndicative: g.uagValueInr, linepackScm: g.linepackScm, zones: g.zones.map(({ daily, ...z }) => ({ ...z, last7DaysUagPct: daily.slice(-7).map((d) => d.uagPct) })), lowestCascades: g.cascade.slice(0, 5), assumptions: g.assumptions },
      evidence: g.evidence,
    };
  },
  get_metering: (args, ctx) => {
    const m = meteringSummary(scoped(ctx, args), "24h");
    return { result: { counts: m.counts, exposureInrPerDayIndicative: m.exposureInrPerDay, exceptions: m.meters.filter((x) => x.status !== "ok").slice(0, 12) }, evidence: m.evidence };
  },
  get_asset_health: (args, ctx) => {
    const r = reliabilitySummary(scoped(ctx, args), "7d");
    const cls = str(args.asset_class);
    return {
      result: { counts: r.counts, assetsWorstFirst: r.assets.filter((a) => !cls || a.cls === cls).slice(0, 10).map(({ vibrationTrend, ...a }) => ({ ...a, vibrationLast3Days: vibrationTrend.slice(-3).map((v) => v.vib) })) },
      evidence: r.evidence,
    };
  },
  get_billing_exceptions: (args, ctx) => {
    const b = billingSummary(scoped(ctx, args), "30d");
    return { result: { bills: b.bills.length, billedInr: b.billedInr, atStakeInrPendingReview: b.atStakeInr, exceptions: b.exceptions.slice(0, 12) }, evidence: b.evidence };
  },
  get_vendor_performance: (_args, ctx) => {
    const v = vendorSummary(ctx.base, "30d");
    return { result: v.vendors.map((x) => ({ id: x.id, vendor: x.vendor, scope: x.scope, status: x.status, slaResponseHours: x.slaResponseHours, avgResponseHours: x.avgResponseHours, slaCompliancePct: x.slaCompliancePct, daysToExpiry: x.daysToExpiry, openWorkOrders: x.openWorkOrders, flags: x.flags })), evidence: v.evidence };
  },
  get_safety: (args, ctx) => {
    const s = safetySummary(scoped(ctx, args), parseWindow(str(args.window)));
    return { result: { cpCompliancePct: s.cpCompliancePct, openHighEvents: s.openHighEvents, unpermittedExcavations: s.unpermittedExcavations, patrolCoveragePct: s.patrolCoveragePct, segmentsByRisk: s.segments.slice(0, 8), openEvents: s.events.filter((e) => e.status === "open").slice(0, 10) }, evidence: s.evidence };
  },
  get_opportunities: async (args, ctx) => {
    const list = await listOpportunities(ctx.user, { zone: str(args.zone)?.toUpperCase(), domain: str(args.domain) });
    return {
      result: {
        count: list.length,
        totalIndicativeInr: list.filter((o) => o.validation === "indicative").reduce((t, o) => t + o.impactInr, 0),
        totalValidatedInr: list.filter((o) => o.validation === "validated").reduce((t, o) => t + (o.validatedValueInr ?? 0), 0),
        items: list.slice(0, 12).map((o) => ({ id: o.id, domain: o.domain, title: o.title, site: o.siteId, zone: o.zoneId, valueInr: o.validation === "validated" ? o.validatedValueInr : o.impactInr, valueState: o.validation, basis: o.impactBasis, status: o.status, owner: o.ownerName ?? o.ownerRole, recommendation: o.recommendation })),
      },
      evidence: list[0]?.evidence ?? null,
    };
  },
  get_alerts: async (args, ctx) => {
    const list = await listAlerts(ctx.user, { status: str(args.status) ?? "open", domain: str(args.domain) });
    return { result: list.slice(0, 15).map((a) => ({ id: a.id, severity: a.severity, domain: a.domain, title: a.title, status: a.status, routedTo: a.routeRole, site: a.siteId, zone: a.zoneId, raised: new Date(a.createdAt).toISOString() })), evidence: list[0]?.evidence ?? null };
  },
  get_data_quality: async () => {
    const st = connectorStatuses();
    const issues = (await listDqIssues()).filter((d) => d.status !== "resolved");
    return { result: { sources: st.map((s) => ({ id: s.id, name: s.name, state: s.state, lagMinutes: s.lagMinutes, expectedFreshnessMin: s.expectedFreshnessMin, message: s.message })), openIssues: issues.slice(0, 15).map((d) => ({ entity: d.entity, kind: d.kind, severity: d.severity, detail: d.detail })) }, evidence: null };
  },
};

export async function executeTool(name: string, args: Args, ctx: { user: User; base: Scope }): Promise<{ result: unknown; record: ToolCallRecord }> {
  const impl = IMPL[name];
  if (!impl) return { result: { error: `Unknown tool ${name}` }, record: { name, args, evidence: null, ok: false, error: "unknown tool" } };
  try {
    const { result, evidence } = await impl(args, ctx);
    return { result: { data: result, evidence, scope: scopeLabel(scoped(ctx, args)) }, record: { name, args, evidence, ok: true } };
  } catch (e) {
    return { result: { error: (e as Error).message }, record: { name, args, evidence: null, ok: false, error: (e as Error).message } };
  }
}

export const fmtInr = (v: number) => (Math.abs(v) >= 1e7 ? `₹${round(v / 1e7, 2)} crore` : `₹${round(v / 1e5, 2)} lakh`);
