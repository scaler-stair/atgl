import { erpBilling } from "../connectors";
import { anchorHour, type DiscomBill } from "../connectors/synthetic";
import { siteById } from "../domain/master";
import type { Evidence, Scope, WindowKey } from "../domain/types";
import { buildEvidence, CALC, resolveWindow, round, scopeSites } from "./common";

export type BillingExceptionKind = "energy-variance" | "demand-exceedance" | "power-factor" | "tariff-category";

export interface BillingException {
  id: string;
  kind: BillingExceptionKind;
  billNo: string;
  siteId: string;
  siteName: string;
  month: string;
  detail: string;
  amountAtStakeInr: number;
  documentRef: string;
  /** Exceptions require human review before any financial action (Section 4). */
  reviewRequired: true;
}

export interface BillingSummary {
  bills: (DiscomBill & { siteName: string; variancePct: number })[];
  exceptions: BillingException[];
  billedInr: number;
  expectedInr: number;
  atStakeInr: number;
  evidence: Evidence;
}

const kindLabel: Record<BillingExceptionKind, string> = {
  "energy-variance": "Billed energy vs measured",
  "demand-exceedance": "Demand over contract",
  "power-factor": "Power factor penalty",
  "tariff-category": "Tariff category mismatch",
};

export function billingKindLabel(k: BillingExceptionKind): string {
  return kindLabel[k];
}

export function billingSummary(scope: Scope, windowKey: WindowKey): BillingSummary {
  const anchor = anchorHour();
  const ids = new Set(scopeSites(scope).map((s) => s.id));
  const bills = erpBilling.read
    .getMonthlyBills(anchor, 3)
    .filter((b) => ids.has(b.siteId))
    .map((b) => ({ ...b, siteName: siteById.get(b.siteId)?.name ?? b.siteId, variancePct: round(((b.billedKwh - b.measuredKwh) / b.measuredKwh) * 100, 2) }));

  const exceptions: BillingException[] = [];
  for (const b of bills) {
    const base = { billNo: b.billNo, siteId: b.siteId, siteName: b.siteName, month: b.month, documentRef: b.documentRef, reviewRequired: true as const };
    if (Math.abs(b.variancePct) > 2) {
      exceptions.push({
        ...base,
        id: `${b.billNo}:energy`,
        kind: "energy-variance",
        detail: `Billed ${b.billedKwh.toLocaleString("en-IN")} kWh vs measured ${b.measuredKwh.toLocaleString("en-IN")} kWh (${b.variancePct > 0 ? "+" : ""}${b.variancePct}%)`,
        amountAtStakeInr: round((b.billedKwh - b.measuredKwh) * b.energyRateInr),
      });
    }
    if (b.recordedMdKva > b.contractDemandKva) {
      const excess = b.recordedMdKva - b.contractDemandKva;
      exceptions.push({
        ...base,
        id: `${b.billNo}:md`,
        kind: "demand-exceedance",
        detail: `Recorded MD ${b.recordedMdKva} kVA exceeds contract demand ${b.contractDemandKva} kVA by ${excess} kVA; review CD revision or load scheduling`,
        amountAtStakeInr: round(excess * b.demandRateInr),
      });
    }
    if (b.powerFactor < 0.9) {
      exceptions.push({
        ...base,
        id: `${b.billNo}:pf`,
        kind: "power-factor",
        detail: `Average PF ${b.powerFactor} below 0.90 threshold; capacitor bank health check`,
        amountAtStakeInr: round((0.9 - b.powerFactor) * b.billedKwh * b.energyRateInr),
      });
    }
    if (b.tariffCategory !== b.expectedTariffCategory) {
      exceptions.push({
        ...base,
        id: `${b.billNo}:tariff`,
        kind: "tariff-category",
        detail: `Billed under ${b.tariffCategory}; connection is registered ${b.expectedTariffCategory}`,
        amountAtStakeInr: round(b.billedKwh * 0.85),
      });
    }
  }
  exceptions.sort((a, b) => b.amountAtStakeInr - a.amountAtStakeInr);
  return {
    bills: bills.sort((a, b) => (a.month < b.month ? 1 : -1) || Math.abs(b.variancePct) - Math.abs(a.variancePct)),
    exceptions,
    billedInr: bills.reduce((t, b) => t + b.billedAmountInr, 0),
    expectedInr: bills.reduce((t, b) => t + b.expectedAmountInr, 0),
    atStakeInr: round(exceptions.reduce((t, e) => t + Math.max(0, e.amountAtStakeInr), 0)),
    evidence: buildEvidence({
      scope,
      window: { ...resolveWindow(windowKey, anchor), label: "Last 3 billing months" },
      sources: ["BILLING", "ERP", "HISTORIAN"],
      version: CALC.billingRecon,
      asOf: anchor - 11 * 3_600_000,
      notes: ["Billing exceptions are for review only; no financial action without validation."],
    }),
  };
}
