import type { Metadata } from "next";
import { EmptyState, PageHeader, Panel, Stat, Tag, type Tone } from "@/components/ui";
import { scopeLabel } from "@/lib/analytics/common";
import { vendorSummary, type VendorRow } from "@/lib/analytics/vendor";
import { date, dateTime, inr, num, pct, titleCase } from "@/lib/format";
import { pageContext, type SearchParams } from "@/lib/server/page";

export const metadata: Metadata = { title: "Vendors and AMC" };

const statusTone: Record<VendorRow["status"], Tone> = { breach: "crit", "at-risk": "warn", "on-track": "ok" };
const statusText: Record<VendorRow["status"], string> = { breach: "SLA breach", "at-risk": "At risk", "on-track": "On track" };
const paymentTone: Record<string, Tone> = { due: "info", "on-hold": "crit", paid: "ok" };

function complianceTone(v: number | null): Tone | undefined {
  if (v === null) return undefined;
  if (v < 80) return "crit";
  if (v < 95) return "warn";
  return "ok";
}

export default async function VendorsPage({ searchParams }: { searchParams: SearchParams }) {
  const { scope, windowKey } = await pageContext("vendors", searchParams);
  const s = vendorSummary(scope, windowKey);
  const ev = s.evidence;
  const v = s.vendors;

  const annual = v.reduce((t, c) => t + c.annualValueInr, 0);
  const breach = v.filter((c) => c.status === "breach").length;
  const atRisk = v.filter((c) => c.status === "at-risk").length;
  const expiring = v.filter((c) => c.daysToExpiry < 60).length;
  const onHold = v.reduce((t, c) => t + c.paymentsOnHold, 0);
  const openWos = v.reduce((t, c) => t + c.openWorkOrders, 0);

  return (
    <>
      <PageHeader
        title="Vendors and AMC"
        description={`Annual maintenance contracts: response SLA performance from work orders, renewal dates and payment status. ${scopeLabel(scope)}.`}
      />

      <Panel evidence={ev}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Contracts in scope" value={num(v.length)} sub={`${inr(annual)} per year`} />
          <Stat label="SLA breach" value={num(breach)} tone={breach ? "crit" : "ok"} sub="Compliance below 80%" />
          <Stat label="At risk" value={num(atRisk)} tone={atRisk ? "warn" : undefined} sub="Renewal, payment or SLA flags" />
          <Stat label="Ending within 60 days" value={num(expiring)} tone={expiring ? "warn" : undefined} sub="Renewal decision needed" />
          <Stat label="Open work orders" value={num(openWos)} sub={`${onHold} payment${onHold === 1 ? "" : "s"} on hold`} />
        </div>
      </Panel>

      <Panel
        className="mt-4"
        title="Contracts"
        description="SLA compliance is the share of responded work orders within the contracted response time. Target 95%."
        evidence={ev}
        bodyClass="p-0"
      >
        {v.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No contracts cover this scope" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vendor and scope</th>
                  <th className="num">Annual value</th>
                  <th>Ends</th>
                  <th className="num">Response SLA / actual</th>
                  <th className="num">SLA compliance</th>
                  <th className="num">Work orders / open</th>
                  <th>Next payment</th>
                  <th>Status and flags</th>
                </tr>
              </thead>
              <tbody>
                {v.map((c) => {
                  const ct = complianceTone(c.slaCompliancePct);
                  const slow = c.avgResponseHours !== null && c.avgResponseHours > c.slaResponseHours;
                  return (
                    <tr key={c.id}>
                      <td className="min-w-[200px]">
                        <span className="block font-medium text-ink">{c.vendor}</span>
                        <span className="block text-[12.5px] text-ink-2">{c.scope}</span>
                        <span className="block text-[12px] text-ink-3">{c.id}</span>
                      </td>
                      <td className="num">{inr(c.annualValueInr)}</td>
                      <td className="whitespace-nowrap">
                        <span className="block text-ink">{date(c.endDate)}</span>
                        <span className={`block text-[12px] ${c.daysToExpiry < 60 ? "font-semibold text-warn" : "text-ink-3"}`}>{num(c.daysToExpiry)} days left</span>
                      </td>
                      <td className="num whitespace-nowrap">
                        {num(c.slaResponseHours)} h / <span className={slow ? "font-semibold text-crit" : ""}>{c.avgResponseHours === null ? "n/a" : `${num(c.avgResponseHours, 1)} h`}</span>
                      </td>
                      <td className="num">
                        {ct && ct !== "ok" ? <Tag tone={ct}>{pct(c.slaCompliancePct, 0)}</Tag> : pct(c.slaCompliancePct, 0)}
                        {c.slaBreaches > 0 && <span className="block text-[12px] text-ink-3">{c.slaBreaches} late</span>}
                      </td>
                      <td className="num">
                        {num(c.workOrders)} / {num(c.openWorkOrders)}
                      </td>
                      <td className="whitespace-nowrap">
                        {c.nextPayment ? (
                          <>
                            <span className="block text-ink">{date(c.nextPayment.dueDate)}</span>
                            <span className="tabular block text-ink-2">{inr(c.nextPayment.amountInr)}</span>
                            <span className="mt-0.5 block">
                              <Tag tone={paymentTone[c.nextPayment.status] ?? "neutral"}>{titleCase(c.nextPayment.status)}</Tag>
                            </span>
                          </>
                        ) : (
                          <span className="text-ink-3">None scheduled</span>
                        )}
                        {c.paymentsOnHold > 0 && <span className="mt-0.5 block text-[12px] font-semibold text-crit">{c.paymentsOnHold} on hold</span>}
                      </td>
                      <td className="min-w-[210px]">
                        <Tag tone={statusTone[c.status]}>{statusText[c.status]}</Tag>
                        {c.flags.length > 0 && (
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-ink-2">
                            {c.flags.map((f) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        className="mt-4"
        title="Recent work orders"
        description={`Latest ${s.recentWorkOrders.length} work orders raised against AMC contracts in scope`}
        evidence={ev}
        bodyClass="p-0"
      >
        {s.recentWorkOrders.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No work orders in this scope" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Work order</th>
                  <th>Asset</th>
                  <th>Site</th>
                  <th>Type</th>
                  <th>Raised</th>
                  <th className="num">Response</th>
                  <th>SLA</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {s.recentWorkOrders.map((w) => (
                  <tr key={w.id}>
                    <td className="whitespace-nowrap font-medium text-ink">{w.id}</td>
                    <td className="min-w-[160px]">
                      <span className="block text-ink">{w.assetName}</span>
                      <span className="block text-[12px] text-ink-3">{w.description}</span>
                    </td>
                    <td className="whitespace-nowrap">{w.siteId}</td>
                    <td>{titleCase(w.type)}</td>
                    <td className="whitespace-nowrap">{dateTime(w.raisedAt)}</td>
                    <td className="num">{w.responseHours === null ? "n/a" : `${num(w.responseHours, 1)} h`}</td>
                    <td>{w.slaMet === null ? <Tag>Awaiting</Tag> : w.slaMet ? <Tag tone="ok">Met</Tag> : <Tag tone="crit">Missed</Tag>}</td>
                    <td className="whitespace-nowrap">{w.closedAt ? <span className="text-ink-2">Closed {dateTime(w.closedAt)}</span> : <Tag tone="info">Open</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
