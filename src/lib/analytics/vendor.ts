import { maintenance } from "../connectors";
import { anchorHour, DAY, HOUR, type VendorPayment, type WorkOrder } from "../connectors/synthetic";
import { assetById, vendorContracts } from "../domain/master";
import type { Evidence, Scope, VendorContract, WindowKey } from "../domain/types";
import { buildEvidence, CALC, resolveWindow, round, scopeSites } from "./common";

export interface VendorRow extends VendorContract {
  daysToExpiry: number;
  workOrders: number;
  openWorkOrders: number;
  avgResponseHours: number | null;
  slaCompliancePct: number | null;
  slaBreaches: number;
  nextPayment: VendorPayment | null;
  paymentsOnHold: number;
  status: "on-track" | "at-risk" | "breach";
  flags: string[];
}

export interface VendorSummary {
  vendors: VendorRow[];
  recentWorkOrders: (WorkOrder & { assetName: string; siteId: string; responseHours: number | null; slaMet: boolean | null })[];
  evidence: Evidence;
}

const STATUS_ORDER: Record<VendorRow["status"], number> = { breach: 0, "at-risk": 1, "on-track": 2 };

export function vendorSummary(scope: Scope, windowKey: WindowKey): VendorSummary {
  const anchor = anchorHour();
  const siteIds = new Set(scopeSites(scope).map((s) => s.id));
  const wos = maintenance.read.getWorkOrders(anchor).filter((w) => siteIds.has(assetById.get(w.assetId)?.siteId ?? ""));
  const payments = maintenance.read.getVendorPayments(anchor);

  const vendors: VendorRow[] = vendorContracts
    .filter((c) => c.siteIds.some((s) => siteIds.has(s)))
    .map((c) => {
      const cw = wos.filter((w) => w.contractId === c.id);
      const responded = cw.filter((w) => w.respondedAt);
      const resp = responded.map((w) => (w.respondedAt! - w.raisedAt) / HOUR);
      const breaches = resp.filter((h) => h > c.slaResponseHours).length;
      const days = Math.round((Date.parse(c.endDate) - anchor) / DAY);
      const cp = payments.filter((p) => p.contractId === c.id);
      const flags: string[] = [];
      const compliance = resp.length ? round(((resp.length - breaches) / resp.length) * 100) : null;
      if (compliance !== null && compliance < 80) flags.push(`SLA compliance ${compliance}% (target 95%)`);
      if (days < 60) flags.push(`Contract ends in ${days} days; renewal decision needed`);
      const hold = cp.filter((p) => p.status === "on-hold").length;
      if (hold) flags.push(`${hold} payment(s) on hold pending service review`);
      return {
        ...c,
        daysToExpiry: days,
        workOrders: cw.length,
        openWorkOrders: cw.filter((w) => !w.closedAt).length,
        avgResponseHours: resp.length ? round(resp.reduce((t, h) => t + h, 0) / resp.length, 1) : null,
        slaCompliancePct: compliance,
        slaBreaches: breaches,
        nextPayment: cp.find((p) => p.status === "due") ?? null,
        paymentsOnHold: hold,
        status: (compliance !== null && compliance < 80 ? "breach" : flags.length ? "at-risk" : "on-track") as VendorRow["status"],
        flags,
      };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  return {
    vendors,
    recentWorkOrders: wos.slice(0, 40).map((w) => {
      const c = vendorContracts.find((x) => x.id === w.contractId)!;
      const rh = w.respondedAt ? round((w.respondedAt - w.raisedAt) / HOUR, 1) : null;
      return { ...w, assetName: assetById.get(w.assetId)?.name ?? w.assetId, siteId: assetById.get(w.assetId)?.siteId ?? "", responseHours: rh, slaMet: rh === null ? null : rh <= c.slaResponseHours };
    }),
    evidence: buildEvidence({ scope, window: { ...resolveWindow(windowKey, anchor), label: "Contract period to date" }, sources: ["MAINTENANCE", "ERP"], version: CALC.vendorSla, asOf: anchor - 12 * 60_000 }),
  };
}
