import type { Metadata } from "next";
import { StackBar } from "@/components/bars";
import { TrendChart } from "@/components/charts";
import { EmptyState, Meter, PageHeader, Panel, Stat, Tag } from "@/components/ui";
import { scopeLabel } from "@/lib/analytics/common";
import { gasSummary } from "@/lib/analytics/gas";
import { inr, num, pct } from "@/lib/format";
import { pageContext, type SearchParams } from "@/lib/server/page";

export const metadata: Metadata = { title: "Gas balance" };

const UAG_LIMIT = 1.2;
const zoneColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export default async function GasPage({ searchParams }: { searchParams: SearchParams }) {
  const { scope, windowKey } = await pageContext("gas", searchParams);
  const g = gasSummary(scope, windowKey);

  // Daily UAG% rows keyed by day, one field per zone.
  const byDay = new Map<string, Record<string, string | number>>();
  for (const z of g.zones) {
    for (const d of z.daily) {
      const row = byDay.get(d.day) ?? { day: d.day };
      row[z.zoneId] = d.uagPct;
      byDay.set(d.day, row);
    }
  }
  const dailyRows = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const uagTone = g.uagPct > UAG_LIMIT ? "crit" : g.uagPct > 0.9 ? "warn" : "ok";

  return (
    <>
      <PageHeader
        title="Gas balance and UAG"
        description={`Fiscal input against metered sales and linepack change, with unaccounted-for gas attributed to its likely causes. ${scopeLabel(scope)}, ${g.evidence.window.label.toLowerCase()}.`}
      />

      <Panel title="Network balance" description="Totals for the zones in scope over the gas days in the window" evidence={g.evidence}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Gas input" value={num(g.inputScm / 1e6, 3)} unit="MMSCM" />
          <Stat label="Metered output" value={num(g.outputScm / 1e6, 3)} unit="MMSCM" />
          <Stat label="UAG" value={pct(g.uagPct, 2)} tone={uagTone} sub={`${num(g.uagScm)} SCM, limit ${pct(UAG_LIMIT)}`} />
          <Stat label="UAG at gas cost" value={inr(g.uagValueInr)} tone="warn" indicative />
          <Stat label="Closing linepack" value={num(g.linepackScm)} unit="SCM" sub="End of last gas day" />
        </div>
      </Panel>

      <div className="mt-4">
        <Panel title="Zone balance" description="All figures in SCM. UAG is input less outputs less linepack change." bodyClass="p-0" evidence={g.evidence}>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th className="num">Input</th>
                  <th className="num">CNG</th>
                  <th className="num">Domestic</th>
                  <th className="num">Industrial</th>
                  <th className="num">Commercial</th>
                  <th className="num">Δ linepack</th>
                  <th className="num">UAG</th>
                  <th className="num">UAG %</th>
                </tr>
              </thead>
              <tbody>
                {g.zones.map((z) => (
                  <tr key={z.zoneId}>
                    <td className="font-medium text-ink">{z.zoneName}</td>
                    <td className="num">{num(z.inputScm)}</td>
                    <td className="num">{num(z.byCategory.cng)}</td>
                    <td className="num">{num(z.byCategory.domestic)}</td>
                    <td className="num">{num(z.byCategory.industrial)}</td>
                    <td className="num">{num(z.byCategory.commercial)}</td>
                    <td className="num">{num(z.deltaLinepackScm)}</td>
                    <td className="num">{num(z.uagScm)}</td>
                    <td className="num">
                      <Tag tone={z.uagPct > UAG_LIMIT ? "crit" : z.uagPct > 0.9 ? "warn" : "ok"}>{pct(z.uagPct, 2)}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Panel title="UAG attribution" description="Estimated split of each zone's unaccounted gas, in SCM over the window" evidence={g.evidence}>
          {g.zones.length === 0 ? (
            <EmptyState title="No zones in scope" />
          ) : (
            <div className="space-y-5">
              {g.zones.map((z) => (
                <div key={z.zoneId}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-[15px] font-semibold text-ink">{z.zoneName}</h3>
                    <span className="text-[12.5px] text-ink-2">
                      {num(z.uagScm)} SCM, {pct(z.uagPct, 2)} of input
                    </span>
                  </div>
                  <StackBar
                    parts={[
                      { key: "meteringError", label: "Metering error", value: z.attribution.meteringError, color: "var(--chart-1)" },
                      { key: "leakage", label: "Leakage", value: z.attribution.leakage, color: "var(--chart-2)" },
                      { key: "billingLag", label: "Billing lag", value: z.attribution.billingLag, color: "var(--chart-3)" },
                      { key: "linepackEstimate", label: "Linepack estimate", value: z.attribution.linepackEstimate, color: "var(--chart-4)" },
                      { key: "unexplained", label: "Unexplained", value: z.attribution.unexplained, color: "var(--chart-5)" },
                    ]}
                    format={(v) => `${num(v)} SCM`}
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Measures and assumptions" description="How the balance and attribution are calculated" evidence={g.evidence}>
            <ul className="list-disc space-y-2 pl-4 text-[13px] text-ink-2">
              {g.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] text-ink-3">Attribution shares are estimates. The unexplained remainder is what the measures above cannot account for.</p>
          </Panel>
          <Panel title="Daily UAG by zone" description="UAG as a share of input per gas day; dashed rule at the 1.2% alert limit" evidence={g.evidence}>
            <TrendChart
              data={dailyRows}
              x="day"
              xMode="day"
              series={g.zones.map((z, i) => ({ key: z.zoneId, label: z.zoneName, color: zoneColors[i % zoneColors.length], unit: "%", digits: 2 }))}
              reference={{ y: UAG_LIMIT, label: "1.2% limit" }}
              height={250}
            />
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
              {g.zones.map((z, i) => (
                <li key={z.zoneId} className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-0.5 w-3.5" style={{ background: zoneColors[i % zoneColors.length] }} />
                  {z.zoneName}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel className="mt-4" title="Cascade inventory" description="CNG stored in station cascades at the latest reading, lowest fill first" bodyClass="p-0" evidence={g.evidence}>
        {g.cascade.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No CNG stations in scope" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Station</th>
                  <th className="num">Stored kg</th>
                  <th className="num">Capacity kg</th>
                  <th className="num">Fill</th>
                  <th className="w-[30%] min-w-32">Level</th>
                </tr>
              </thead>
              <tbody>
                {g.cascade.map((c) => {
                  const low = c.fillPct < 30;
                  return (
                    <tr key={c.siteId}>
                      <td className="font-medium text-ink">{c.siteName}</td>
                      <td className="num">{num(c.kg)}</td>
                      <td className="num">{num(c.capacityKg)}</td>
                      <td className="num">{low ? <Tag tone="warn">{pct(c.fillPct, 0)}</Tag> : pct(c.fillPct, 0)}</td>
                      <td className="align-middle">
                        <Meter value={c.fillPct} tone={low ? "warn" : "flow"} label={`${c.siteName} cascade fill ${c.fillPct}%`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
