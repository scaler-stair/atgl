import type { Metadata } from "next";
import { TrendChart } from "@/components/charts";
import { EmptyState, Notice, PageHeader, Panel, SeverityTag, Stat, Tag, type Tone } from "@/components/ui";
import { scopeLabel } from "@/lib/analytics/common";
import { CP_CRITERION_V, safetySummary, type SegmentIntegrity } from "@/lib/analytics/safety";
import { zoneById } from "@/lib/domain/master";
import { dateTime, num, pct, titleCase } from "@/lib/format";
import { pageContext, type SearchParams } from "@/lib/server/page";

export const metadata: Metadata = { title: "Safety and integrity" };

const riskTone: Record<SegmentIntegrity["risk"], Tone> = { high: "crit", medium: "warn", low: "ok" };

export default async function SafetyPage({ searchParams }: { searchParams: SearchParams }) {
  const { scope, windowKey } = await pageContext("safety", searchParams);
  const s = safetySummary(scope, windowKey);
  const ev = s.evidence;

  // Worst segment for the CP chart: highest (least negative) potential among segments with CP test points.
  const withCp = s.segments.filter((g) => g.worstPotentialV !== null);
  const worst = withCp.reduce<SegmentIntegrity | null>((w, g) => (!w || (g.worstPotentialV ?? -9) > (w.worstPotentialV ?? -9) ? g : w), null);
  const cpData = worst
    ? s.cp
        .filter((r) => r.segmentId === worst.segmentId)
        .sort((a, b) => a.testPoint.localeCompare(b.testPoint))
        .map((r) => ({ tp: r.testPoint, v: r.potentialV }))
    : [];
  const minV = Math.min(...cpData.map((d) => d.v), CP_CRITERION_V);
  const events = [...s.events].sort((a, b) => b.at - a.at);

  return (
    <>
      <PageHeader
        title="Safety and integrity"
        description={`Cathodic protection, patrol coverage and third-party activity near the pipeline network. ${scopeLabel(scope)}.`}
      />

      <Notice title="Advisory only">
        Safety intelligence routes alerts to the responsible workflow (patrol, CP maintenance or emergency response) and never triggers operational action.
      </Notice>

      <Panel className="mt-4" evidence={ev}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
          <Stat
            label="CP compliance"
            value={pct(s.cpCompliancePct)}
            tone={s.cpCompliancePct < 95 ? "crit" : s.cpCompliancePct < 98 ? "warn" : "ok"}
            sub={`${s.cp.length} test points, criterion ${num(CP_CRITERION_V, 2)} V or lower`}
          />
          <Stat label="Open high-severity events" value={num(s.openHighEvents)} tone={s.openHighEvents ? "crit" : "ok"} />
          <Stat label="Unpermitted excavations" value={num(s.unpermittedExcavations)} tone={s.unpermittedExcavations ? "crit" : "ok"} sub="Third-party digging without a permit" />
          <Stat label="Patrol coverage, 7 days" value={pct(s.patrolCoveragePct, 0)} tone={s.patrolCoveragePct < 80 ? "warn" : undefined} sub="Share of network km patrolled" />
        </div>
      </Panel>

      <div className="mt-4 grid gap-4">
        <Panel title="Segment integrity" description="Steel segments carry cathodic protection test points; MDPE segments do not need CP." evidence={ev} bodyClass="p-0">
          {s.segments.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No pipeline segments in this scope" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Segment</th>
                    <th>Material</th>
                    <th className="num">Length km</th>
                    <th className="num">CP test points</th>
                    <th className="num">Compliant</th>
                    <th className="num">Worst potential</th>
                    <th>Failing points</th>
                    <th className="num">Patrolled</th>
                    <th className="num">Open events</th>
                    <th>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {s.segments.map((g) => (
                    <tr key={g.segmentId}>
                      <td className="min-w-[190px]">
                        <span className="block font-medium text-ink">{g.name}</span>
                        <span className="block text-[12px] text-ink-3">
                          {g.segmentId}, {zoneById.get(g.zoneId)?.name ?? g.zoneId} zone
                        </span>
                      </td>
                      <td>{g.material === "steel" ? "Steel" : g.material}</td>
                      <td className="num">{num(g.lengthKm)}</td>
                      <td className="num">{g.cpTestPoints || "n/a"}</td>
                      <td className="num">{g.cpCompliantPct === null ? "n/a" : pct(g.cpCompliantPct, 0)}</td>
                      <td className={`num ${g.worstPotentialV !== null && g.worstPotentialV > CP_CRITERION_V ? "font-semibold text-crit" : ""}`}>
                        {g.worstPotentialV === null ? "n/a" : `${num(g.worstPotentialV, 3)} V`}
                      </td>
                      <td className="text-[12.5px]">{g.failingTestPoints.length ? g.failingTestPoints.join(", ") : <span className="text-ink-3">None</span>}</td>
                      <td className={`num ${g.patrolledDaysAgo === null || g.patrolledDaysAgo > 7 ? "text-warn font-semibold" : ""}`}>
                        {g.patrolledDaysAgo === null ? "No record" : g.patrolledDaysAgo === 0 ? "Today" : `${g.patrolledDaysAgo} d ago`}
                      </td>
                      <td className="num">{num(g.openEvents)}</td>
                      <td>
                        <Tag tone={riskTone[g.risk]}>{titleCase(g.risk)}</Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="CP readings, worst segment"
          description={worst ? `${worst.name}: pipe-to-soil ON potential per test point. Readings above ${num(CP_CRITERION_V, 2)} V are under-protected.` : "No CP test points in this scope"}
          evidence={ev}
        >
          {cpData.length === 0 ? (
            <EmptyState title="No CP readings in this scope">Only steel segments carry cathodic protection test points.</EmptyState>
          ) : (
            <>
              <TrendChart
                data={cpData}
                x="tp"
                xMode="raw"
                height={260}
                leftDomain={[Math.floor(minV * 10) / 10 - 0.05, 0]}
                reference={{ y: CP_CRITERION_V, label: "Protection criterion" }}
                series={[{ key: "v", label: "Potential", color: "var(--chart-2)", type: "bar", unit: "V", digits: 3 }]}
              />
              <p className="mt-2 text-[12px] text-ink-3">
                Criterion: at least {num(CP_CRITERION_V, 2)} V vs copper sulphate electrode. Failing test points: {worst?.failingTestPoints.length ? worst.failingTestPoints.join(", ") : "none"}.
              </p>
            </>
          )}
        </Panel>
      </div>

      <Panel className="mt-4" title="Safety events" description="Events in the selected window plus anything still open, newest first" evidence={ev} bodyClass="p-0">
        {events.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No safety events in this window" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Zone</th>
                  <th>Kind</th>
                  <th>Severity</th>
                  <th>Description</th>
                  <th>Permit</th>
                  <th className="num">Distance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">
                      <span className="block">{dateTime(e.at)}</span>
                      <span className="block text-[12px] text-ink-3">{e.id}</span>
                    </td>
                    <td>{e.zoneName}</td>
                    <td className="whitespace-nowrap">{titleCase(e.kind)}</td>
                    <td>
                      <SeverityTag severity={e.severity} />
                    </td>
                    <td className="min-w-[240px] max-w-[460px] text-ink-2">{e.description}</td>
                    <td>{e.permitted === undefined ? <span className="text-ink-3">n/a</span> : e.permitted ? "Permitted" : <Tag tone="crit">No permit</Tag>}</td>
                    <td className="num">{e.distanceM === undefined ? "n/a" : `${num(e.distanceM)} m`}</td>
                    <td>{e.status === "open" ? <Tag tone="warn">Open</Tag> : <Tag>Closed</Tag>}</td>
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
