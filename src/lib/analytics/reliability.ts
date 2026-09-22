import { historian, maintenance } from "../connectors";
import { anchorHour, DAY, HOUR, rand } from "../connectors/synthetic";
import { assets, siteById } from "../domain/master";
import type { Asset, Evidence, Scope, WindowKey } from "../domain/types";
import { buildEvidence, CALC, resolveWindow, round, scopeSites } from "./common";

export type HealthState = "healthy" | "watch" | "alert";

export interface AssetHealth {
  assetId: string;
  siteId: string;
  siteName: string;
  name: string;
  cls: Asset["cls"];
  criticality: Asset["criticality"];
  health: number;
  state: HealthState;
  findings: string[];
  confidence: number;
  modelVersion: string;
  lastSample: string | null;
  vibrationTrend: { day: number; vib: number | null; temp: number | null }[];
  openWorkOrders: number;
}

export interface ReliabilitySummary {
  assets: AssetHealth[];
  counts: Record<HealthState, number>;
  evidence: Evidence;
}

const cache = new Map<string, ReliabilitySummary>();

function dailyStats(assetId: string, anchor: number, days: number) {
  const out: { day: number; vib: number | null; temp: number | null; n: number }[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const from = anchor - (d + 1) * DAY + HOUR;
    const series = historian.read.getCompressorSeries(assetId, from, anchor - d * DAY, anchor).filter((s) => s.running && !s.flag);
    const n = series.length;
    out.push({
      day: anchor - d * DAY,
      vib: n ? round(series.reduce((t, s) => t + s.vibrationMmS, 0) / n, 2) : null,
      temp: n ? round(series.reduce((t, s) => t + s.bearingTempC, 0) / n, 1) : null,
      n,
    });
  }
  return out;
}

export function reliabilitySummary(scope: Scope, windowKey: WindowKey): ReliabilitySummary {
  const anchor = anchorHour();
  const key = JSON.stringify([scope, anchor]);
  const hit = cache.get(key);
  if (hit) return { ...hit, evidence: { ...hit.evidence, window: resolveWindow(windowKey, anchor) } };

  const siteIds = new Set(scopeSites(scope).map((s) => s.id));
  const wos = maintenance.read.getWorkOrders(anchor);
  const rows: AssetHealth[] = [];

  for (const a of assets.filter((x) => siteIds.has(x.siteId))) {
    const findings: string[] = [];
    let health = 92 + Math.round(rand(a.id + ":h") * 6);
    let confidence = 0.6;
    let lastSample: string | null = null;
    let trend: AssetHealth["vibrationTrend"] = [];
    const open = wos.filter((w) => w.assetId === a.id && !w.closedAt);

    const drivenCompressor = a.cls === "compressor" ? a.id : a.cls === "motor" ? a.id.replace("-MTR-", "-CMP-") : null;
    if (drivenCompressor) {
      const stats = dailyStats(drivenCompressor, anchor, 14);
      trend = stats.map(({ day, vib, temp }) => ({ day, vib, temp }));
      const recent = stats.slice(-3).filter((s) => s.vib !== null);
      const base = stats.slice(0, 4).filter((s) => s.vib !== null);
      const expected = 14 * 24;
      const got = stats.reduce((t, s) => t + s.n, 0);
      confidence = round(Math.min(0.95, 0.55 + 0.4 * Math.min(1, got / (expected * 0.6))), 2);
      const lastRun = historian.read.getCompressorSeries(drivenCompressor, anchor - 12 * HOUR, anchor, anchor).at(-1);
      lastSample = lastRun ? new Date(lastRun.ts).toISOString() : null;
      if (recent.length && base.length) {
        const rv = recent.reduce((t, s) => t + (s.vib ?? 0), 0) / recent.length;
        const bv = base.reduce((t, s) => t + (s.vib ?? 0), 0) / base.length;
        const rt = recent.reduce((t, s) => t + (s.temp ?? 0), 0) / recent.length;
        const bt = base.reduce((t, s) => t + (s.temp ?? 0), 0) / base.length;
        const vibFactor = a.cls === "motor" ? 0.55 : 1;
        const vib = rv * vibFactor;
        if (vib > 4.5) {
          health -= 38;
          findings.push(`Vibration ${round(vib, 1)} mm/s RMS in ISO 10816 zone C (alert), up ${round(((rv - bv) / bv) * 100)}% vs 2-week baseline`);
        } else if (vib > 2.8) {
          health -= 16;
          findings.push(`Vibration ${round(vib, 1)} mm/s RMS in ISO 10816 zone B, rising trend`);
        }
        if (rt - bt > 6) {
          health -= a.cls === "motor" ? 14 : 10;
          findings.push(`Bearing temperature +${round(rt - bt, 1)} °C vs baseline`);
        }
      } else {
        confidence = 0.3;
        findings.push("Insufficient recent telemetry to score; check acquisition");
      }
    } else {
      const age = (anchor - Date.parse(a.commissioned)) / (365 * DAY);
      if (age > 8) {
        health -= 8;
        findings.push(`Asset age ${round(age, 1)} years; condition-based inspection recommended`);
      }
      confidence = 0.5;
    }
    const breakdowns = open.filter((w) => w.type === "breakdown");
    if (breakdowns.length) {
      health -= 6 * breakdowns.length;
      findings.push(`${breakdowns.length} open breakdown work order(s): ${breakdowns.map((w) => w.id).join(", ")}`);
    }
    health = Math.max(5, Math.min(100, health));
    rows.push({
      assetId: a.id,
      siteId: a.siteId,
      siteName: siteById.get(a.siteId)?.name ?? a.siteId,
      name: a.name,
      cls: a.cls,
      criticality: a.criticality,
      health,
      state: health < 60 ? "alert" : health < 80 ? "watch" : "healthy",
      findings,
      confidence,
      modelVersion: CALC.assetHealth,
      lastSample,
      vibrationTrend: trend,
      openWorkOrders: open.length,
    });
  }
  rows.sort((a, b) => a.health - b.health);
  const value: ReliabilitySummary = {
    assets: rows,
    counts: {
      healthy: rows.filter((r) => r.state === "healthy").length,
      watch: rows.filter((r) => r.state === "watch").length,
      alert: rows.filter((r) => r.state === "alert").length,
    },
    evidence: buildEvidence({
      scope,
      window: resolveWindow(windowKey, anchor),
      sources: ["HISTORIAN", "RTU", "MAINTENANCE"],
      version: CALC.assetHealth,
      notes: ["Health scores are advisory predictions, not maintenance instructions."],
    }),
  };
  if (cache.size > 32) cache.clear();
  cache.set(key, value);
  return value;
}
