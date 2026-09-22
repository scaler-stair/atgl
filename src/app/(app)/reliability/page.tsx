import type { Metadata } from "next";
import Link from "next/link";
import { Sparkline, TrendChart } from "@/components/charts";
import { EmptyState, KeyValue, Meter, Notice, PageHeader, Panel, Stat, Tag, type Tone } from "@/components/ui";
import { scopeLabel } from "@/lib/analytics/common";
import { reliabilitySummary, type HealthState } from "@/lib/analytics/reliability";
import type { AssetClass } from "@/lib/domain/types";
import { ago, num, pct, titleCase } from "@/lib/format";
import { pageContext, type SearchParams } from "@/lib/server/page";

export const metadata: Metadata = { title: "Reliability" };

const VIB_LIMIT = 4.5;
const stateTone: Record<HealthState, Tone> = { alert: "crit", watch: "warn", healthy: "ok" };
const stateText: Record<HealthState, string> = { alert: "Alert", watch: "Watch", healthy: "Healthy" };
const healthTone = (h: number): Tone => (h < 60 ? "crit" : h < 80 ? "warn" : "ok");

export default async function ReliabilityPage({ searchParams }: { searchParams: SearchParams }) {
  const { scope, windowKey, params } = await pageContext("reliability", searchParams);
  const r = reliabilitySummary(scope, windowKey);
  const classes = [...new Set(r.assets.map((a) => a.cls))].sort() as AssetClass[];
  // Default view lists only assets needing attention; "All" shows the full fleet.
  const active = params.cls === "all" ? "all" : params.cls && classes.includes(params.cls as AssetClass) ? (params.cls as AssetClass) : "attention";
  const rows = active === "all" ? r.assets : active === "attention" ? r.assets.filter((a) => a.state !== "healthy") : r.assets.filter((a) => a.cls === active);
  const worst = rows.find((a) => a.vibrationTrend.some((t) => t.vib !== null)) ?? null;

  const hrefFor = (c: string) => {
    const q = new URLSearchParams(Object.entries(params).filter(([k, v]) => k !== "cls" && v) as [string, string][]);
    if (c !== "attention") q.set("cls", c);
    const s = q.toString();
    return s ? `/reliability?${s}` : "/reliability";
  };

  return (
    <>
      <PageHeader
        title="Asset reliability"
        description={`Condition scores for compressors, motors and station equipment from vibration, bearing temperature and work order history. ${scopeLabel(scope)}.`}
      />

      <Notice tone="info" title="Predictions are advisory">
        Health scores and findings are model predictions to support planning. They are never maintenance instructions or equipment commands; the maintenance team decides and acts through its own work order process.
      </Notice>

      <Panel className="mt-4" title="Fleet condition" description="Alert: health below 60. Watch: 60 to 79. Healthy: 80 and above." evidence={r.evidence}>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Alert" value={num(r.counts.alert)} tone={r.counts.alert ? "crit" : undefined} unit="assets" />
          <Stat label="Watch" value={num(r.counts.watch)} tone={r.counts.watch ? "warn" : undefined} unit="assets" />
          <Stat label="Healthy" value={num(r.counts.healthy)} tone="ok" unit="assets" />
        </div>
      </Panel>

      {worst && (
        <Panel
          className="mt-4"
          title={`Lowest scored monitored asset: ${worst.name}`}
          description={`${worst.siteName}, ${worst.assetId}. Daily mean vibration and bearing temperature over 14 days.`}
          evidence={r.evidence}
        >
          <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
            <div className="min-w-0">
              <TrendChart
                data={worst.vibrationTrend}
                x="day"
                xMode="day"
                series={[
                  { key: "vib", label: "Vibration", color: "var(--chart-1)", unit: "mm/s", digits: 2 },
                  { key: "temp", label: "Bearing temperature", color: "var(--chart-2)", axis: "right", unit: "°C", digits: 1 },
                ]}
                reference={{ y: VIB_LIMIT, label: "4.5 mm/s zone C" }}
                height={230}
              />
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-0.5 w-3.5" style={{ background: "var(--chart-1)" }} />
                  Vibration, mm/s RMS (left)
                </li>
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-0.5 w-3.5" style={{ background: "var(--chart-2)" }} />
                  Bearing temperature, °C (right)
                </li>
              </ul>
            </div>
            <div className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="font-display tabular text-[32px] font-semibold leading-9" style={{ color: `var(--${healthTone(worst.health)})` }}>
                  {worst.health}
                </span>
                <span className="text-[13px] text-ink-3">/100 health</span>
                <Tag tone={stateTone[worst.state]}>{stateText[worst.state]}</Tag>
              </div>
              <KeyValue
                items={[
                  ["Class", titleCase(worst.cls)],
                  ["Criticality", worst.criticality],
                  ["Confidence", pct(worst.confidence * 100, 0)],
                  ["Model", worst.modelVersion],
                  ["Open work orders", num(worst.openWorkOrders)],
                  ["Last sample", ago(worst.lastSample)],
                ]}
              />
              {worst.findings.length > 0 && (
                <ul className="list-disc space-y-1 pl-4 text-[13px] text-ink-2">
                  {worst.findings.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      )}

      <Panel
        className="mt-4"
        title="Assets"
        description={`${rows.length} assets, lowest health first`}
        bodyClass="p-0"
        evidence={r.evidence}
      >
        <div className="border-b border-line-2 px-4 py-2.5">
          <nav aria-label="Filter by asset class" className="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-line bg-surface">
            {["attention", "all", ...classes].map((c) => (
              <Link
                key={c}
                href={hrefFor(c)}
                aria-current={active === c ? "page" : undefined}
                className={`px-3 py-1.5 text-[13px] font-semibold ${active === c ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"}`}
              >
                {c === "attention" ? "Needs attention" : c === "all" ? "All" : titleCase(c)}
              </Link>
            ))}
          </nav>
        </div>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No assets match this filter" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Site</th>
                  <th>Class</th>
                  <th className="min-w-32">Health</th>
                  <th>State</th>
                  <th>Vibration, 14 days</th>
                  <th>Findings</th>
                  <th className="num">Confidence</th>
                  <th>Model, last sample</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const vib = a.vibrationTrend.map((t) => t.vib);
                  const tone = healthTone(a.health);
                  return (
                    <tr key={a.assetId}>
                      <td>
                        <span className="font-medium whitespace-nowrap text-ink">{a.name}</span>
                        <span className="block whitespace-nowrap text-[12px] text-ink-3">{a.assetId}</span>
                      </td>
                      <td className="min-w-32 text-ink-2">{a.siteName}</td>
                      <td className="whitespace-nowrap text-ink-2">
                        {titleCase(a.cls)}
                        <span className="block text-[12px] text-ink-3">Criticality {a.criticality}</span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="tabular w-7 text-right font-semibold" style={{ color: `var(--${tone})` }}>
                            {a.health}
                          </span>
                          <div className="flex-1">
                            <Meter value={a.health} tone={tone} label={`Health ${a.health} of 100`} />
                          </div>
                        </div>
                      </td>
                      <td>
                        <Tag tone={stateTone[a.state]}>{stateText[a.state]}</Tag>
                      </td>
                      <td>
                        {vib.some((v) => v !== null) ? (
                          <Sparkline values={vib} threshold={VIB_LIMIT} color={a.state === "alert" ? "var(--crit)" : "var(--flow)"} />
                        ) : (
                          <span className="text-[12.5px] text-ink-3">Not monitored</span>
                        )}
                      </td>
                      <td className="min-w-52 text-[12.5px] text-ink-2">
                        {a.findings.length ? (
                          <ul className="space-y-0.5">
                            {a.findings.map((f) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-ink-3">No findings</span>
                        )}
                      </td>
                      <td className="num">{pct(a.confidence * 100, 0)}</td>
                      <td className="whitespace-nowrap">
                        <span className="block text-[12px] text-ink-3" title={a.modelVersion}>
                          Model {a.modelVersion.includes("@") ? `v${a.modelVersion.split("@")[1]}` : a.modelVersion}
                        </span>
                        <span className="text-ink-2">{a.lastSample ? ago(a.lastSample) : "No sample"}</span>
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
