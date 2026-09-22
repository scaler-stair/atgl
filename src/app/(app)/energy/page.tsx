import type { Metadata } from "next";
import { RankBars } from "@/components/bars";
import { TrendChart } from "@/components/charts";
import { EmptyState, PageHeader, Panel, Stat, Tag, type Tone } from "@/components/ui";
import { scopeLabel } from "@/lib/analytics/common";
import { energySummary } from "@/lib/analytics/energy";
import { inr, num, pct, signed } from "@/lib/format";
import { pageContext, type SearchParams } from "@/lib/server/page";

export const metadata: Metadata = { title: "Energy" };

function gapTone(gap: number | null): Tone | undefined {
  if (gap === null) return undefined;
  if (gap >= 15) return "crit";
  if (gap > 5) return "warn";
  return undefined;
}

export default async function EnergyPage({ searchParams }: { searchParams: SearchParams }) {
  const { scope, windowKey } = await pageContext("energy", searchParams);
  const e = energySummary(scope, windowKey);
  const bench = e.benchmarkSec;
  const above = e.networkSec !== null && bench !== null && e.networkSec > bench * 1.05;
  const compShare = e.totalKwh ? (e.compressionKwh / e.totalKwh) * 100 : 0;
  const ranked = e.sites.filter((s) => s.secKwhPerKg !== null);
  const rankMax = Math.max(...ranked.map((s) => s.secKwhPerKg ?? 0), bench ?? 0) * 1.05;

  return (
    <>
      <PageHeader
        title="Compression energy"
        description={`Electricity drawn by CNG compressors and station auxiliaries, and specific energy per kg compressed. ${scopeLabel(scope)}, ${e.evidence.window.label.toLowerCase()}.`}
      />

      <Panel title="Energy position" description="Network specific energy against the best-quartile station in scope" evidence={e.evidence}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-3 xl:grid-cols-5">
          <Stat
            label="Specific energy"
            value={num(e.networkSec, 3)}
            unit="kWh/kg"
            tone={above ? "warn" : undefined}
            sub={`Best-quartile benchmark ${num(bench, 3)}`}
          />
          <Stat label="Electricity" value={num(e.totalKwh / 1000, 1)} unit="MWh" />
          <Stat label="CNG compressed" value={num(e.kgCompressed)} unit="kg" />
          <Stat
            label="Compression vs auxiliary"
            value={pct(compShare, 0)}
            sub={`${num(e.compressionKwh / 1000, 1)} MWh compression, ${num(e.auxKwh / 1000, 1)} MWh auxiliary`}
          />
          <Stat label="Excess over benchmark" value={inr(e.excessInr)} tone="warn" indicative sub={`${num(e.excessKwh)} kWh above best quartile`} />
        </div>
        <div className="mt-5">
          <TrendChart
            data={e.hourly}
            series={[
              { key: "kwh", label: "Electricity", color: "var(--chart-3)", type: "area", unit: "kWh", digits: 0 },
              { key: "sec", label: "Specific energy", color: "var(--chart-1)", axis: "right", unit: "kWh/kg", digits: 3 },
            ]}
            reference={bench !== null ? { y: bench, label: `Benchmark ${num(bench, 3)}`, axis: "right" } : undefined}
            height={240}
          />
          <p className="mt-1 text-[12px] text-ink-3">Shaded area: hourly kWh (left axis). Line: specific energy in kWh/kg (right axis), dashed rule at the benchmark.</p>
        </div>
      </Panel>

      <Panel className="mt-4" title="Station benchmarking" description="Specific energy per compressing station; the vertical rule marks the best-quartile benchmark" evidence={e.evidence}>
        {ranked.length === 0 ? (
          <EmptyState title="No compression in this scope">Select a zone or site with CNG stations.</EmptyState>
        ) : (
          <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
            {[ranked.slice(0, Math.ceil(ranked.length / 2)), ranked.slice(Math.ceil(ranked.length / 2))].map((half, i) => (
              <RankBars
                key={i}
                max={rankMax}
                rows={half.map((s) => {
                  const t = gapTone(s.benchmarkGapPct);
                  return {
                    key: s.siteId,
                    label: s.siteName,
                    value: s.secKwhPerKg ?? 0,
                    tone: t === "crit" ? "crit" : t === "warn" ? "warn" : "flow",
                    note: `${s.type}, ${signed(s.benchmarkGapPct)} vs benchmark`,
                  };
                })}
                format={(v) => `${num(v, 3)} kWh/kg`}
                reference={bench !== null ? { value: bench, label: `Benchmark ${num(bench, 3)} kWh/kg` } : undefined}
              />
            ))}
          </div>
        )}
      </Panel>

      <div className="mt-4">
        <Panel title="Stations" description="Sorted by gap to benchmark; excess kWh is energy above the best-quartile rate. Sites without compression show auxiliary load only." bodyClass="p-0" evidence={e.evidence}>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Type</th>
                  <th className="num">Compression kWh</th>
                  <th className="num">Auxiliary kWh</th>
                  <th className="num">kg</th>
                  <th className="num">SEC kWh/kg</th>
                  <th className="num">Gap</th>
                  <th className="num">Excess kWh</th>
                </tr>
              </thead>
              <tbody>
                {e.sites.map((s) => {
                  const t = gapTone(s.benchmarkGapPct);
                  return (
                    <tr key={s.siteId}>
                      <td className="font-medium whitespace-nowrap text-ink">{s.siteName}</td>
                      <td className="whitespace-nowrap text-ink-2">{s.type}</td>
                      <td className="num">{num(s.compressionKwh)}</td>
                      <td className="num">{num(s.auxKwh)}</td>
                      <td className="num">{num(s.kgCompressed)}</td>
                      <td className="num font-semibold">{num(s.secKwhPerKg, 3)}</td>
                      <td className="num">{t ? <Tag tone={t}>{signed(s.benchmarkGapPct)}</Tag> : <span className="text-ink-2">{signed(s.benchmarkGapPct)}</span>}</td>
                      <td className="num">{s.excessKwh ? num(s.excessKwh) : <span className="text-ink-3">0</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel
        className="mt-4"
        title="Compressors"
        description="Per-unit energy, throughput and run hours. Samples below the expected hourly count are flagged as data gaps."
        bodyClass="p-0"
        evidence={e.evidence}
      >
        {e.compressors.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No compressors in this scope" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Unit</th>
                  <th className="num">kWh</th>
                  <th className="num">kg</th>
                  <th className="num">SEC kWh/kg</th>
                  <th className="num">Run hours</th>
                  <th className="num">Mean suction bar</th>
                  <th className="num">Samples</th>
                </tr>
              </thead>
              <tbody>
                {e.compressors.map((c) => {
                  const gap = c.secKwhPerKg !== null && bench ? ((c.secKwhPerKg - bench) / bench) * 100 : null;
                  const t = gapTone(gap);
                  const missing = c.expectedSamples - c.samples;
                  return (
                    <tr key={c.assetId}>
                      <td className="whitespace-nowrap text-ink-2">{c.siteName}</td>
                      <td>
                        <span className="font-medium whitespace-nowrap text-ink">{c.name}</span>
                        <span className="ml-1.5 text-[12px] text-ink-3">{c.assetId}</span>
                      </td>
                      <td className="num">{num(c.kwh)}</td>
                      <td className="num">{num(c.kg)}</td>
                      <td className="num">{t ? <Tag tone={t}>{num(c.secKwhPerKg, 3)}</Tag> : <span className="font-semibold">{num(c.secKwhPerKg, 3)}</span>}</td>
                      <td className="num">{num(c.runHours)}</td>
                      <td className="num">{num(c.avgSuctionBar, 1)}</td>
                      <td className="num">
                        {num(c.samples)}/{num(c.expectedSamples)}
                        {missing > 0 && (
                          <span className="ml-1.5">
                            <Tag tone="warn" title={`${missing} hourly samples missing or flagged`}>
                              Data gap
                            </Tag>
                          </span>
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
    </>
  );
}
