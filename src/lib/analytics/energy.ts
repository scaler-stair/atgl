import { historian } from "../connectors";
import { anchorHour, HOUR } from "../connectors/synthetic";
import { assets, siteTypeLabel } from "../domain/master";
import type { Evidence, Scope, WindowKey } from "../domain/types";
import { ASSUMPTIONS, buildEvidence, CALC, resolveWindow, round, scopeSites, windowRange } from "./common";

export interface CompressorEnergy {
  assetId: string;
  siteId: string;
  siteName: string;
  name: string;
  kwh: number;
  kg: number;
  secKwhPerKg: number | null;
  runHours: number;
  avgSuctionBar: number | null;
  samples: number;
  expectedSamples: number;
}

export interface SiteEnergy {
  siteId: string;
  siteName: string;
  zoneId: string;
  type: string;
  compressionKwh: number;
  auxKwh: number;
  totalKwh: number;
  kgCompressed: number;
  secKwhPerKg: number | null;
  benchmarkGapPct: number | null;
  excessKwh: number;
}

export interface EnergySummary {
  totalKwh: number;
  compressionKwh: number;
  auxKwh: number;
  kgCompressed: number;
  networkSec: number | null;
  benchmarkSec: number | null;
  excessKwh: number;
  excessInr: number;
  sites: SiteEnergy[];
  compressors: CompressorEnergy[];
  hourly: { ts: number; kwh: number; sec: number | null }[];
  evidence: Evidence;
}

const cache = new Map<string, { at: number; value: EnergySummary }>();

export function energySummary(scope: Scope, windowKey: WindowKey): EnergySummary {
  const anchor = anchorHour();
  const key = JSON.stringify([scope, windowKey, anchor]);
  const hit = cache.get(key);
  if (hit) return hit.value;

  const { from, to } = windowRange(windowKey, anchor);
  const inScope = scopeSites(scope);
  const hourly = new Map<number, { kwh: number; kg: number }>();
  const compressors: CompressorEnergy[] = [];
  const siteRows: SiteEnergy[] = [];

  for (const site of inScope) {
    let cKwh = 0;
    let cKg = 0;
    for (const a of assets.filter((x) => x.siteId === site.id && x.cls === "compressor")) {
      const series = historian.read.getCompressorSeries(a.id, from, to, anchor);
      let kwh = 0, kg = 0, run = 0, suc = 0, sucN = 0, good = 0;
      for (const s of series) {
        if (s.flag) continue;
        good++;
        kwh += s.kwh;
        kg += s.kgCompressed;
        if (s.running) {
          run++;
          suc += s.suctionBar;
          sucN++;
        }
        const h = hourly.get(s.ts) ?? { kwh: 0, kg: 0 };
        h.kwh += s.kwh;
        h.kg += s.kgCompressed;
        hourly.set(s.ts, h);
      }
      cKwh += kwh;
      cKg += kg;
      compressors.push({
        assetId: a.id,
        siteId: site.id,
        siteName: site.name,
        name: a.name,
        kwh: round(kwh),
        kg: round(kg),
        secKwhPerKg: kg > 0 ? round(kwh / kg, 3) : null,
        runHours: run,
        avgSuctionBar: sucN ? round(suc / sucN, 1) : null,
        samples: good,
        expectedSamples: Math.round((to - from) / HOUR) + 1,
      });
    }
    let aux = 0;
    for (let ts = from; ts <= to; ts += HOUR) {
      const v = historian.read.getSiteAuxKwh(site.id, ts);
      aux += v;
      const h = hourly.get(ts) ?? { kwh: 0, kg: 0 };
      h.kwh += v;
      hourly.set(ts, h);
    }
    siteRows.push({
      siteId: site.id,
      siteName: site.name,
      zoneId: site.zoneId,
      type: siteTypeLabel[site.type],
      compressionKwh: round(cKwh),
      auxKwh: round(aux),
      totalKwh: round(cKwh + aux),
      kgCompressed: round(cKg),
      secKwhPerKg: cKg > 0 ? round((cKwh + aux) / cKg, 3) : null,
      benchmarkGapPct: null,
      excessKwh: 0,
    });
  }

  // Benchmark = best-quartile SEC among CNG stations in scope (min 4), else fleet default.
  const secs = siteRows.map((s) => s.secKwhPerKg).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const benchmark = secs.length >= 4 ? secs[Math.floor(secs.length / 4)] : secs.length ? 0.24 : null;
  let excessKwh = 0;
  for (const s of siteRows) {
    if (s.secKwhPerKg !== null && benchmark) {
      s.benchmarkGapPct = round(((s.secKwhPerKg - benchmark) / benchmark) * 100, 1);
      s.excessKwh = Math.max(0, round((s.secKwhPerKg - benchmark) * s.kgCompressed));
      excessKwh += s.excessKwh;
    }
  }
  siteRows.sort((a, b) => (b.benchmarkGapPct ?? -99) - (a.benchmarkGapPct ?? -99));
  compressors.sort((a, b) => (b.secKwhPerKg ?? 0) - (a.secKwhPerKg ?? 0));

  const compressionKwh = siteRows.reduce((t, s) => t + s.compressionKwh, 0);
  const auxKwh = siteRows.reduce((t, s) => t + s.auxKwh, 0);
  const kg = siteRows.reduce((t, s) => t + s.kgCompressed, 0);
  const window = resolveWindow(windowKey, anchor);
  const incomplete = compressors.filter((c) => c.samples < c.expectedSamples);

  const value: EnergySummary = {
    totalKwh: round(compressionKwh + auxKwh),
    compressionKwh: round(compressionKwh),
    auxKwh: round(auxKwh),
    kgCompressed: round(kg),
    networkSec: kg > 0 ? round((compressionKwh + auxKwh) / kg, 3) : null,
    benchmarkSec: benchmark,
    excessKwh: round(excessKwh),
    excessInr: round(excessKwh * ASSUMPTIONS.energyRateInrPerKwh),
    sites: siteRows,
    compressors,
    hourly: [...hourly.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, v]) => ({ ts, kwh: round(v.kwh), sec: v.kg > 0 ? round(v.kwh / v.kg, 3) : null })),
    evidence: buildEvidence({
      scope,
      window,
      sources: ["HISTORIAN", "RTU", "MASTER"],
      version: CALC.energySec,
      notes: incomplete.length ? [`${incomplete.length} compressor series have gaps; totals use available samples only`] : undefined,
    }),
  };
  if (cache.size > 64) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}
