import type { Scope, WindowKey } from "../domain/types";
import { billingSummary } from "./billing";
import { energySummary } from "./energy";
import { gasSummary } from "./gas";
import { meteringSummary } from "./metering";
import { reliabilitySummary } from "./reliability";
import { safetySummary } from "./safety";
import { vendorSummary } from "./vendor";

export function overview(scope: Scope, windowKey: WindowKey) {
  const energy = energySummary(scope, windowKey);
  const gas = gasSummary(scope, windowKey);
  const metering = meteringSummary(scope, windowKey);
  const reliability = reliabilitySummary(scope, windowKey);
  const billing = billingSummary(scope, windowKey);
  const vendor = vendorSummary(scope, windowKey);
  const safety = safetySummary(scope, windowKey);
  return {
    energy: {
      totalKwh: energy.totalKwh,
      networkSec: energy.networkSec,
      benchmarkSec: energy.benchmarkSec,
      excessInr: energy.excessInr,
      worstSites: energy.sites.slice(0, 3).map((s) => ({ siteId: s.siteId, siteName: s.siteName, gapPct: s.benchmarkGapPct, sec: s.secKwhPerKg })),
      evidence: energy.evidence,
    },
    gas: {
      inputScm: gas.inputScm,
      uagPct: gas.uagPct,
      uagScm: gas.uagScm,
      uagValueInr: gas.uagValueInr,
      zones: gas.zones.map((z) => ({ zoneId: z.zoneId, zoneName: z.zoneName, uagPct: z.uagPct })),
      evidence: gas.evidence,
    },
    metering: { counts: metering.counts, exposureInrPerDay: metering.exposureInrPerDay, evidence: metering.evidence },
    reliability: {
      counts: reliability.counts,
      worst: reliability.assets.slice(0, 3).map((a) => ({ assetId: a.assetId, name: a.name, siteName: a.siteName, health: a.health })),
      evidence: reliability.evidence,
    },
    billing: { exceptions: billing.exceptions.length, atStakeInr: billing.atStakeInr, evidence: billing.evidence },
    vendor: {
      breach: vendor.vendors.filter((v) => v.status === "breach").length,
      atRisk: vendor.vendors.filter((v) => v.status === "at-risk").length,
      total: vendor.vendors.length,
      evidence: vendor.evidence,
    },
    safety: {
      cpCompliancePct: safety.cpCompliancePct,
      openHighEvents: safety.openHighEvents,
      unpermittedExcavations: safety.unpermittedExcavations,
      patrolCoveragePct: safety.patrolCoveragePct,
      evidence: safety.evidence,
    },
  };
}

export type Overview = ReturnType<typeof overview>;
