import { historian, scadaGas } from "../connectors";
import { anchorHour, type ZoneGasDay } from "../connectors/synthetic";
import { sites, zoneById } from "../domain/master";
import type { Evidence, Scope, WindowKey } from "../domain/types";
import { ASSUMPTIONS, buildEvidence, CALC, dayStarts, resolveWindow, round, scopeSites, scopeZoneIds } from "./common";

export interface ZoneBalance {
  zoneId: string;
  zoneName: string;
  inputScm: number;
  outputScm: number;
  deltaLinepackScm: number;
  uagScm: number;
  uagPct: number;
  attribution: ZoneGasDay["attribution"];
  byCategory: { cng: number; domestic: number; industrial: number; commercial: number };
  daily: { day: string; uagPct: number; inputScm: number; uagScm: number }[];
}

export interface GasSummary {
  inputScm: number;
  outputScm: number;
  uagScm: number;
  uagPct: number;
  uagValueInr: number;
  linepackScm: number;
  zones: ZoneBalance[];
  cascade: { siteId: string; siteName: string; kg: number; capacityKg: number; fillPct: number }[];
  evidence: Evidence;
  /** Assumptions behind UAG attribution, surfaced with every explanation. */
  assumptions: string[];
}

export const UAG_ASSUMPTIONS = [
  "UAG = input (fiscal inlet) − metered outputs − Δlinepack over the gas day (06:00–06:00 IST).",
  "Metering-error share estimated from check-meter drift on district and industrial meters.",
  "Leakage share estimated from open leak-survey findings and MDPE network length.",
  "Billing-lag share reflects domestic PNG consumption billed on bi-monthly cycles.",
  "Linepack computed from segment volume, average pressure and temperature (AGA-8 compressibility).",
];

export function gasSummary(scope: Scope, windowKey: WindowKey): GasSummary {
  const anchor = anchorHour();
  const days = dayStarts(windowKey, anchor);
  const zoneIds = scopeZoneIds(scope);
  const zones: ZoneBalance[] = zoneIds.map((zoneId) => {
    const rows = days.map((d) => scadaGas.read.getZoneGasDay(zoneId, d));
    const sum = (f: (r: ZoneGasDay) => number) => rows.reduce((t, r) => t + f(r), 0);
    const input = sum((r) => r.inputScm);
    const cng = sum((r) => r.cngScm);
    const domestic = sum((r) => r.domesticScm);
    const industrial = sum((r) => r.industrialScm);
    const commercial = sum((r) => r.commercialScm);
    const dLp = sum((r) => r.linepackCloseScm - r.linepackOpenScm);
    const uag = sum((r) => r.uagScm);
    return {
      zoneId,
      zoneName: zoneById.get(zoneId)?.name ?? zoneId,
      inputScm: input,
      outputScm: cng + domestic + industrial + commercial,
      deltaLinepackScm: dLp,
      uagScm: uag,
      uagPct: round((uag / input) * 100, 2),
      attribution: {
        meteringError: sum((r) => r.attribution.meteringError),
        leakage: sum((r) => r.attribution.leakage),
        billingLag: sum((r) => r.attribution.billingLag),
        linepackEstimate: sum((r) => r.attribution.linepackEstimate),
        unexplained: sum((r) => r.attribution.unexplained),
      },
      byCategory: { cng, domestic, industrial, commercial },
      daily: rows.map((r) => ({ day: r.day, uagPct: round((r.uagScm / r.inputScm) * 100, 2), inputScm: r.inputScm, uagScm: r.uagScm })),
    };
  });
  zones.sort((a, b) => b.uagPct - a.uagPct);
  const inputScm = zones.reduce((t, z) => t + z.inputScm, 0);
  const uagScm = zones.reduce((t, z) => t + z.uagScm, 0);
  const lastDay = days[days.length - 1];
  const linepack = zoneIds.reduce((t, z) => t + scadaGas.read.getZoneGasDay(z, lastDay).linepackCloseScm, 0);

  const cascade = scopeSites(scope)
    .filter((s) => s.type.startsWith("CNG"))
    .map((s) => {
      const c = historian.read.getCascadeInventory(s.id, anchor);
      return { siteId: s.id, siteName: s.name, kg: c.kg, capacityKg: c.capacityKg, fillPct: round((c.kg / c.capacityKg) * 100) };
    })
    .sort((a, b) => a.fillPct - b.fillPct);

  const zoneSiteIds = sites.filter((s) => zoneIds.includes(s.zoneId) && s.type === "CGS").map((s) => s.id);
  return {
    inputScm,
    outputScm: zones.reduce((t, z) => t + z.outputScm, 0),
    uagScm,
    uagPct: inputScm ? round((uagScm / inputScm) * 100, 2) : 0,
    uagValueInr: round(uagScm * ASSUMPTIONS.gasCostInrPerScm),
    linepackScm: linepack,
    zones,
    cascade,
    assumptions: UAG_ASSUMPTIONS,
    evidence: buildEvidence({
      scope,
      window: resolveWindow(windowKey, anchor),
      sources: ["SCADA", "HISTORIAN", "BILLING", "MASTER"],
      version: `${CALC.gasBalance} + ${CALC.uagAttribution}`,
      siteIds: zoneSiteIds,
      notes: scope.siteId ? ["Gas balance is computed per zone; showing the zone that contains the selected site."] : undefined,
    }),
  };
}
