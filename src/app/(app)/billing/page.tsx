import type { Metadata } from "next";
import { TrendChart } from "@/components/charts";
import { EmptyState, Notice, PageHeader, Panel, Stat, Tag, type Tone } from "@/components/ui";
import { billingKindLabel, billingSummary } from "@/lib/analytics/billing";
import { scopeLabel } from "@/lib/analytics/common";
import { inr, num, signed } from "@/lib/format";
import { pageContext, type SearchParams } from "@/lib/server/page";

export const metadata: Metadata = { title: "Billing assurance" };

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

function varianceTone(v: number): Tone | undefined {
  const a = Math.abs(v);
  if (a > 5) return "crit";
  if (a > 2) return "warn";
  return undefined;
}

export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  const { scope, windowKey } = await pageContext("billing", searchParams);
  const s = billingSummary(scope, windowKey);
  const ev = s.evidence;

  const latestMonth = s.bills.reduce((m, b) => (b.month > m ? b.month : m), "");
  const chartData = s.bills
    .filter((b) => b.month === latestMonth)
    .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
    .slice(0, 12)
    .map((b) => ({ site: b.siteId, measured: b.measuredKwh, billed: b.billedKwh }));
  const pendingExceptions = s.exceptions.filter((e) => e.amountAtStakeInr > 0).length;

  return (
    <>
      <PageHeader
        title="Billing assurance"
        description={`Electricity bills from the discoms reconciled against measured consumption, contract demand and tariff category. ${scopeLabel(scope)}, last 3 billing months.`}
      />

      <Notice tone="warn" title="Exceptions require review before any financial action">
        Every exception below is a prompt for review by the finance team, not a claim. Source bill documents are retained and referenced so each figure can be checked against the original.
      </Notice>

      <Panel className="mt-4" evidence={ev}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Bills reconciled" value={num(s.bills.length)} sub={`${new Set(s.bills.map((b) => b.siteId)).size} sites, 3 months`} />
          <Stat label="Billed" value={inr(s.billedInr)} sub="As invoiced by discoms" />
          <Stat label="Expected" value={inr(s.expectedInr)} sub={`Difference ${inr(s.billedInr - s.expectedInr)}`} />
          <Stat label="Exceptions" value={num(s.exceptions.length)} tone={s.exceptions.length ? "warn" : "ok"} sub={`${pendingExceptions} with a positive amount at stake`} />
          <Stat label="At stake, pending review" value={inr(s.atStakeInr)} tone={s.atStakeInr ? "warn" : undefined} indicative />
        </div>
      </Panel>

      <Panel
        className="mt-4"
        title="Exception queue"
        description="Ordered by amount at stake. Each item needs review and sign-off before any dispute, credit claim or payment change."
        evidence={ev}
        bodyClass="p-0"
      >
        {s.exceptions.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No billing exceptions in this scope">All bills reconcile within tolerance for the last 3 billing months.</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Exception</th>
                  <th>Site</th>
                  <th>Month</th>
                  <th>Detail</th>
                  <th className="num">At stake</th>
                  <th>Bill and source document</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {s.exceptions.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium text-ink whitespace-nowrap">{billingKindLabel(e.kind)}</td>
                    <td>
                      <span className="block text-ink">{e.siteName}</span>
                      <span className="block text-[12px] text-ink-3">{e.siteId}</span>
                    </td>
                    <td className="whitespace-nowrap">{monthLabel(e.month)}</td>
                    <td className="min-w-[260px] max-w-[420px] text-ink-2">{e.detail}</td>
                    <td className="num font-semibold">{inr(e.amountAtStakeInr)}</td>
                    <td>
                      <span className="block whitespace-nowrap text-ink">{e.billNo}</span>
                      <span className="block text-[12px] text-ink-3 break-all">{e.documentRef}</span>
                    </td>
                    <td>
                      <Tag tone="warn">Review required</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        className="mt-4"
        title="Measured vs billed energy"
        description={latestMonth ? `${monthLabel(latestMonth)}, the ${chartData.length} sites with the largest variance between billed and meter-measured kWh` : "No bills in scope"}
        evidence={ev}
      >
        {chartData.length === 0 ? (
          <EmptyState title="No bills in this scope" />
        ) : (
          <TrendChart
            data={chartData}
            x="site"
            xMode="raw"
            height={260}
            series={[
              { key: "measured", label: "Measured", color: "var(--chart-3)", type: "bar", unit: "kWh", digits: 0 },
              { key: "billed", label: "Billed", color: "var(--chart-1)", type: "bar", unit: "kWh", digits: 0 },
            ]}
          />
        )}
      </Panel>

      <Panel
        className="mt-4"
        title="All bills"
        description={`${s.bills.length} bills, newest month first. Variance is billed minus measured kWh; amber above 2%, red above 5%.`}
        evidence={ev}
        bodyClass="p-0"
      >
        <div className="max-h-[640px] overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Site</th>
                <th className="num">Measured kWh</th>
                <th className="num">Billed kWh</th>
                <th className="num">Variance</th>
                <th className="num">Recorded MD / contract kVA</th>
                <th className="num">PF</th>
                <th className="num">Billed</th>
                <th className="num">Expected</th>
              </tr>
            </thead>
            <tbody>
              {s.bills.map((b) => {
                const vt = varianceTone(b.variancePct);
                const over = b.recordedMdKva > b.contractDemandKva;
                return (
                  <tr key={b.billNo}>
                    <td className="whitespace-nowrap">{monthLabel(b.month)}</td>
                    <td>
                      <span className="block text-ink">{b.siteName}</span>
                      <span className="block text-[12px] text-ink-3">{b.siteId}</span>
                    </td>
                    <td className="num">{num(b.measuredKwh)}</td>
                    <td className="num">{num(b.billedKwh)}</td>
                    <td className="num">{vt ? <Tag tone={vt}>{signed(b.variancePct, 2)}</Tag> : signed(b.variancePct, 2)}</td>
                    <td className={`num ${over ? "font-semibold text-crit" : ""}`}>
                      {num(b.recordedMdKva)} / {num(b.contractDemandKva)}
                    </td>
                    <td className={`num ${b.powerFactor < 0.9 ? "font-semibold text-crit" : ""}`}>{num(b.powerFactor, 3)}</td>
                    <td className="num">{inr(b.billedAmountInr)}</td>
                    <td className="num text-ink-2">{inr(b.expectedAmountInr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
