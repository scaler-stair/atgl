import { rtu } from "../connectors";
import { anchorHour, DAY, HOUR } from "../connectors/synthetic";
import { siteById, sites, zoneById } from "../domain/master";
import type { Evidence, QualityState, Scope, Site, SourceSystem, TimeWindow, WindowKey } from "../domain/types";

/** Versioned calculation rules (SOP-05). Bump on any formula change. */
export const CALC = {
  energySec: "energy-sec@1.3.0",
  gasBalance: "gas-balance@2.1.0",
  uagAttribution: "uag-attribution@1.0.2",
  meterDrift: "meter-drift@1.1.0",
  assetHealth: "asset-health-model@0.9.4",
  billingRecon: "billing-recon@1.2.0",
  vendorSla: "vendor-sla@1.0.0",
  cpCriteria: "cp-criteria@1.0.0",
  safetyExposure: "excavation-exposure@1.0.1",
  opportunity: "opportunity-sizing@1.0.0",
} as const;

/** Commercial assumptions used for indicative rupee values only. */
export const ASSUMPTIONS = {
  energyRateInrPerKwh: 7.35,
  gasCostInrPerScm: 38.5,
  industrialGasPriceInrPerScm: 46.2,
  note: "Indicative until validated in the ATGL study and approved business case.",
};

export const WINDOWS: Record<WindowKey, { label: string; hours: number }> = {
  "24h": { label: "Last 24 hours", hours: 24 },
  "7d": { label: "Last 7 days", hours: 7 * 24 },
  "30d": { label: "Last 30 days", hours: 30 * 24 },
};

export function parseWindow(v: string | undefined | null): WindowKey {
  return v === "24h" || v === "30d" ? v : "7d";
}

export function resolveWindow(key: WindowKey, anchor = anchorHour()): TimeWindow {
  const w = WINDOWS[key];
  return { key, from: new Date(anchor - (w.hours - 1) * HOUR).toISOString(), to: new Date(anchor).toISOString(), label: w.label };
}

export function windowRange(key: WindowKey, anchor = anchorHour()): { from: number; to: number; days: number } {
  const w = WINDOWS[key];
  return { from: anchor - (w.hours - 1) * HOUR, to: anchor, days: Math.max(1, Math.round(w.hours / 24)) };
}

export function dayStarts(key: WindowKey, anchor = anchorHour()): number[] {
  const { days } = windowRange(key, anchor);
  // Gas balance days close at 06:00 IST; last closed day ends before today.
  const istMidnight = Math.floor((anchor + 5.5 * HOUR) / DAY) * DAY - 5.5 * HOUR;
  return Array.from({ length: days }, (_, i) => istMidnight - (days - i) * DAY);
}

export function scopeSites(scope: Scope): Site[] {
  return sites.filter(
    (s) =>
      (!scope.allowedSiteIds || scope.allowedSiteIds.includes(s.id)) &&
      (!scope.zoneId || s.zoneId === scope.zoneId) &&
      (!scope.siteId || s.id === scope.siteId),
  );
}

export function scopeZoneIds(scope: Scope): string[] {
  return [...new Set(scopeSites(scope).map((s) => s.zoneId))];
}

export function scopeLabel(scope: Scope): string {
  if (scope.siteId) return siteById.get(scope.siteId)?.name ?? scope.siteId;
  if (scope.zoneId) return `${zoneById.get(scope.zoneId)?.name ?? scope.zoneId} zone`;
  return scope.allowedSiteIds ? `${scope.allowedSiteIds.length} assigned sites` : "All zones";
}

const qualityRank: Record<QualityState, number> = { good: 0, degraded: 1, stale: 2, missing: 3 };

export function worstQuality(...q: QualityState[]): QualityState {
  return q.reduce((a, b) => (qualityRank[b] > qualityRank[a] ? b : a), "good" as QualityState);
}

/**
 * Build the evidence block for a figure. Quality is derived from the
 * contributing sites' acquisition lag so stale data is surfaced, never hidden.
 */
export function buildEvidence(opts: {
  scope: Scope;
  window: TimeWindow;
  sources: SourceSystem[];
  version: string;
  siteIds?: string[];
  asOf?: number;
  quality?: QualityState;
  notes?: string[];
}): Evidence {
  const now = Date.now();
  const siteIds = opts.siteIds ?? scopeSites(opts.scope).map((s) => s.id);
  const notes = [...(opts.notes ?? [])];
  let quality: QualityState = opts.quality ?? "good";
  let asOf = opts.asOf ?? now;
  if (opts.sources.some((s) => s === "RTU" || s === "HISTORIAN" || s === "SCADA") && opts.asOf === undefined) {
    const lags = siteIds.map((id) => ({ id, lag: rtu.read.getSiteLag(id, now) }));
    const stale = lags.filter((l) => l.lag.lagMinutes > 60);
    asOf = now - Math.max(0, ...lags.map((l) => l.lag.lagMinutes)) * 60_000;
    if (stale.length && stale.length === lags.length) quality = worstQuality(quality, "stale");
    else if (stale.length) {
      quality = worstQuality(quality, "degraded");
      notes.push(`Stale feed excluded after last good sample: ${stale.map((s) => s.id).join(", ")}`);
    }
  }
  if (siteIds.length === 0) quality = "missing";
  return {
    window: opts.window,
    sources: opts.sources,
    quality,
    asOf: new Date(asOf).toISOString(),
    version: opts.version,
    scopeLabel: scopeLabel(opts.scope),
    notes: notes.length ? notes : undefined,
  };
}

export const round = (v: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
