import { gis } from "../connectors";
import { anchorHour, DAY, type CpReading, type SafetyEvent } from "../connectors/synthetic";
import { pipelineSegments, zoneById } from "../domain/master";
import type { Evidence, Scope, WindowKey } from "../domain/types";
import { buildEvidence, CALC, resolveWindow, round, scopeZoneIds, windowRange } from "./common";

/** NACE SP0169 criterion: ON potential at least -0.85 V vs CSE. */
export const CP_CRITERION_V = -0.85;

export interface SegmentIntegrity {
  segmentId: string;
  name: string;
  zoneId: string;
  material: string;
  lengthKm: number;
  cpTestPoints: number;
  cpCompliantPct: number | null;
  worstPotentialV: number | null;
  failingTestPoints: string[];
  patrolledDaysAgo: number | null;
  openEvents: number;
  risk: "low" | "medium" | "high";
}

export interface SafetySummary {
  segments: SegmentIntegrity[];
  events: (SafetyEvent & { zoneName: string })[];
  cp: CpReading[];
  cpCompliancePct: number;
  openHighEvents: number;
  unpermittedExcavations: number;
  patrolCoveragePct: number;
  evidence: Evidence;
}

const RISK_ORDER: Record<SegmentIntegrity["risk"], number> = { high: 0, medium: 1, low: 2 };

export function safetySummary(scope: Scope, windowKey: WindowKey): SafetySummary {
  const anchor = anchorHour();
  const zones = new Set(scopeZoneIds(scope));
  const { from } = windowRange(windowKey, anchor);
  const cp = gis.read.getCpReadings(anchor).filter((r) => zones.has(r.segmentId.split("-")[0]));
  const allEvents = gis.read.getSafetyEvents(anchor).filter((e) => zones.has(e.zoneId));
  const events = allEvents.filter((e) => e.at >= from || e.status === "open");

  const segments: SegmentIntegrity[] = pipelineSegments
    .filter((s) => zones.has(s.zoneId))
    .map((s) => {
      const r = cp.filter((x) => x.segmentId === s.id);
      const failing = r.filter((x) => x.potentialV > CP_CRITERION_V);
      const patrol = allEvents.filter((e) => e.kind === "patrol" && e.segmentId === s.id).sort((a, b) => b.at - a.at)[0];
      const open = allEvents.filter((e) => e.segmentId === s.id && e.status === "open");
      const high = open.some((e) => e.severity === "high") || failing.length >= 2;
      return {
        segmentId: s.id,
        name: s.name,
        zoneId: s.zoneId,
        material: s.material,
        lengthKm: s.lengthKm,
        cpTestPoints: r.length,
        cpCompliantPct: r.length ? round(((r.length - failing.length) / r.length) * 100) : null,
        worstPotentialV: r.length ? Math.max(...r.map((x) => x.potentialV)) : null,
        failingTestPoints: failing.map((x) => x.testPoint),
        patrolledDaysAgo: patrol ? Math.floor((anchor - patrol.at) / DAY) : null,
        openEvents: open.length,
        risk: (high ? "high" : open.length || failing.length ? "medium" : "low") as SegmentIntegrity["risk"],
      };
    })
    .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);

  const km = segments.reduce((t, s) => t + s.lengthKm, 0);
  const patrolledKm = segments.filter((s) => s.patrolledDaysAgo !== null && s.patrolledDaysAgo <= 7).reduce((t, s) => t + s.lengthKm, 0);
  return {
    segments,
    events: events.map((e) => ({ ...e, zoneName: zoneById.get(e.zoneId)?.name ?? e.zoneId })),
    cp,
    cpCompliancePct: cp.length ? round((cp.filter((r) => r.potentialV <= CP_CRITERION_V).length / cp.length) * 100, 1) : 100,
    openHighEvents: events.filter((e) => e.status === "open" && e.severity === "high").length,
    unpermittedExcavations: events.filter((e) => e.kind === "excavation" && e.permitted === false).length,
    patrolCoveragePct: km ? round((patrolledKm / km) * 100) : 0,
    evidence: buildEvidence({
      scope,
      window: resolveWindow(windowKey, anchor),
      sources: ["GIS", "MASTER"],
      version: `${CALC.cpCriteria} + ${CALC.safetyExposure}`,
      asOf: anchor - 38 * 60_000,
      notes: ["Safety intelligence routes to the responsible workflow; it never triggers operational action."],
    }),
  };
}
