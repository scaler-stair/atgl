import { rtu } from "../connectors";
import { anchorHour, DAY } from "../connectors/synthetic";
import { meters, siteById } from "../domain/master";
import type { Evidence, Meter, Scope, WindowKey } from "../domain/types";
import { ASSUMPTIONS, buildEvidence, CALC, resolveWindow, round, scopeSites } from "./common";

export type MeterStatus = "ok" | "watch" | "fault";

export interface MeterRow {
  meterId: string;
  siteId: string;
  siteName: string;
  role: Meter["role"];
  tech: Meter["tech"];
  customer?: string;
  flowScmh: number;
  driftPct: number;
  calibrationAgeDays: number;
  calibrationOverdue: boolean;
  diagnosticsOk: boolean;
  unitMismatch: string | null;
  status: MeterStatus;
  reasons: string[];
  /** Indicative daily revenue exposure from drift, INR. */
  exposureInrPerDay: number;
  sampledAt: string;
}

export interface MeteringSummary {
  meters: MeterRow[];
  counts: Record<MeterStatus, number>;
  exposureInrPerDay: number;
  evidence: Evidence;
}

export function meteringSummary(scope: Scope, windowKey: WindowKey): MeteringSummary {
  const anchor = anchorHour();
  const ids = new Set(scopeSites(scope).map((s) => s.id));
  const rows: MeterRow[] = meters
    .filter((m) => ids.has(m.siteId))
    .map((m) => {
      const h = rtu.read.getMeterHealth(m.id, anchor);
      const age = Math.floor((anchor - Date.parse(m.lastCalibration)) / DAY);
      const overdue = age > 365;
      const reasons: string[] = [];
      let status: MeterStatus = "ok";
      if (Math.abs(h.driftPct) >= 1.5) {
        status = "fault";
        reasons.push(`Drift ${h.driftPct}% vs check meter exceeds ±1.5% limit`);
      } else if (Math.abs(h.driftPct) >= 0.75) {
        status = "watch";
        reasons.push(`Drift ${h.driftPct}% approaching limit`);
      }
      if (!h.diagnosticsOk) {
        status = "fault";
        reasons.push("Meter self-diagnostics report path / sensor fault");
      }
      if (overdue) {
        if (status === "ok") status = "watch";
        reasons.push(`Calibration ${age} days old (policy: 365)`);
      }
      const unitMismatch = h.unitReported !== h.unitExpected ? `Pressure tag reports ${h.unitReported}, dictionary expects ${h.unitExpected}` : null;
      if (unitMismatch) {
        if (status === "ok") status = "watch";
        reasons.push(unitMismatch);
      }
      // Revenue exposure only for sales meters under-registering beyond the watch limit.
      // (Fiscal inlet drift affects purchase reconciliation, tracked via UAG instead.)
      const salesMeter = m.role === "industrial" || m.role === "commercial";
      const exposure = salesMeter && h.driftPct <= -0.75 ? (Math.abs(h.driftPct) / 100) * h.flowScmh * 24 * ASSUMPTIONS.industrialGasPriceInrPerScm : 0;
      return {
        meterId: m.id,
        siteId: m.siteId,
        siteName: siteById.get(m.siteId)?.name ?? m.siteId,
        role: m.role,
        tech: m.tech,
        customer: m.customer,
        flowScmh: h.flowScmh,
        driftPct: h.driftPct,
        calibrationAgeDays: age,
        calibrationOverdue: overdue,
        diagnosticsOk: h.diagnosticsOk,
        unitMismatch,
        status,
        reasons,
        exposureInrPerDay: round(exposure),
        sampledAt: new Date(h.sampledAt).toISOString(),
      };
    })
    .sort((a, b) => ({ fault: 0, watch: 1, ok: 2 })[a.status] - ({ fault: 0, watch: 1, ok: 2 })[b.status] || b.exposureInrPerDay - a.exposureInrPerDay);

  return {
    meters: rows,
    counts: {
      ok: rows.filter((r) => r.status === "ok").length,
      watch: rows.filter((r) => r.status === "watch").length,
      fault: rows.filter((r) => r.status === "fault").length,
    },
    exposureInrPerDay: round(rows.reduce((t, r) => t + r.exposureInrPerDay, 0)),
    evidence: buildEvidence({ scope, window: resolveWindow(windowKey, anchor), sources: ["RTU", "SCADA", "MASTER"], version: CALC.meterDrift }),
  };
}
