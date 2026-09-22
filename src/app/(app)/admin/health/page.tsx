import type { Metadata } from "next";
import Link from "next/link";
import { KeyValue, Notice, Panel, PageHeader, Stat, Tag, type Tone } from "@/components/ui";
import { agentById } from "@/lib/agents/definitions";
import { config, geminiConfigured } from "@/lib/config";
import { connectorStatuses, type ConnectorState } from "@/lib/connectors";
import { ago, dateTime, num, pct, titleCase } from "@/lib/format";
import { healthSnapshot, recentAgentFailures } from "@/lib/server/admin";
import { pageContext, type SearchParams } from "@/lib/server/page";

export const metadata: Metadata = { title: "System health" };

const stateTone: Record<ConnectorState, Tone> = { healthy: "ok", degraded: "warn", failed: "crit" };

function bytes(n: number | null): string {
  if (n === null) return "n/a";
  if (n < 1024 * 1024) return `${num(n / 1024, 0)} KB`;
  return `${num(n / (1024 * 1024), 1)} MB`;
}

export default async function HealthPage({ searchParams }: { searchParams: SearchParams }) {
  await pageContext("admin-health", searchParams);
  const h = await healthSnapshot();
  const now = h.at;
  const connectors = connectorStatuses(now);
  const failures = await recentAgentFailures(8);
  const runAgeH = h.lastRunAt ? (now - h.lastRunAt) / 3_600_000 : null;
  const unhealthy = connectors.filter((c) => c.state !== "healthy").length;

  return (
    <>
      <PageHeader
        title="System health"
        description="Platform status for the operations and security teams. A machine-readable summary without personal data is served at /api/health for monitoring."
        actions={
          <a href="/api/health" className="btn" target="_blank" rel="noreferrer">
            Open health JSON
          </a>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active users" value={num(h.activeUsers)} />
        <Stat label="Active sessions" value={num(h.activeSessions)} />
        <Stat label="Open alerts" value={num(h.openAlerts)} tone={h.openAlerts ? "warn" : "ok"} />
        <Stat label="Open data-quality issues" value={num(h.openDqIssues)} tone={h.openDqIssues ? "warn" : "ok"} />
        <Stat label="Agent runs, 24 h" value={num(h.runs24h)} sub={`${num(h.failedRuns24h)} failed`} tone={h.failedRuns24h ? "crit" : undefined} />
        <Stat label="Last agent run" value={runAgeH === null ? "never" : ago(h.lastRunAt)} tone={runAgeH === null || runAgeH > 6 ? "warn" : "ok"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="Environment">
          <KeyValue
            items={[
              ["Environment", <Tag key="e" tone={config.appEnv === "production" ? "brand" : "warn"}>{titleCase(config.appEnv)}</Tag>],
              ["Data mode", <Tag key="d" tone={config.dataMode === "live" ? "ok" : "warn"}>{titleCase(config.dataMode)}</Tag>],
              ["Tenant", `${config.tenantName} (${config.tenantId})`],
              ["Database", h.driver === "postgres" ? "PostgreSQL (Neon), private atgl schema" : "SQLite (local file)"],
              ["Schema version", h.schemaVersion ?? "unknown"],
              ["Database size", bytes(h.dbBytes)],
              ["Session policy", `${config.sessionTtlHours} h absolute, ${config.sessionIdleMinutes} min idle`],
              ["Language model", geminiConfigured() ? `Configured, ${config.gemini.model}` : "Not configured"],
            ]}
          />
        </Panel>

        <Panel title="Connectors" description={unhealthy ? `${unhealthy} not healthy` : "All sources healthy"} actions={<Link href="/admin/integrations" className="btn">Open integrations</Link>} bodyClass="p-0">
          <ul>
            {connectors.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 border-b border-line-2 px-4 py-2 last:border-b-0">
                <span className="min-w-0 text-[13.5px]">
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="block text-[12px] text-ink-3">Last good sample {ago(c.lastGoodSample)}</span>
                </span>
                <Tag tone={stateTone[c.state]}>{titleCase(c.state)}</Tag>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Executive copilot, last 24 h">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Questions" value={num(h.copilot.count)} />
            <Stat label="Avg latency" value={h.copilot.avgLatencyMs === null ? "n/a" : num(h.copilot.avgLatencyMs / 1000, 1)} unit={h.copilot.avgLatencyMs === null ? undefined : "s"} />
            <Stat label="Grounded" value={pct(h.copilot.groundedPct, 0)} tone={h.copilot.groundedPct !== null && h.copilot.groundedPct < 95 ? "warn" : undefined} />
          </div>
          <p className="mt-3 text-[12.5px] text-ink-3">Grounded means the answer cited data returned by approved read-only tools.</p>
        </Panel>

        <Panel title="Sign-in anomalies, last 24 h" actions={<Link href="/admin/audit?action=auth." className="btn">Open audit log</Link>}>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Failed sign-ins" value={num(h.login.failures)} tone={h.login.failures > 10 ? "warn" : undefined} />
            <Stat label="Lockouts" value={num(h.login.lockouts)} tone={h.login.lockouts ? "crit" : undefined} />
            <Stat label="Access denials" value={num(h.login.denied)} tone={h.login.denied ? "warn" : undefined} />
          </div>
          <p className="mt-3 text-[12.5px] text-ink-3">Five failed attempts lock an account for 15 minutes. Repeated lockouts may indicate credential stuffing: follow SOP-07.</p>
        </Panel>

        <Panel title="Recent agent failures" actions={<Link href="/agents" className="btn">Open agents</Link>} bodyClass="p-0">
          {failures.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-ink-2">No failed agent runs recorded.</p>
          ) : (
            <ul>
              {failures.map((f) => (
                <li key={f.id} className="border-b border-line-2 px-4 py-2 last:border-b-0 text-[13px]">
                  <span className="font-semibold text-ink">{agentById.get(f.agent_id)?.name ?? f.agent_id}</span>
                  <span className="ml-2 text-[12px] text-ink-3">{dateTime(f.started_at)}</span>
                  <p className="text-crit">{f.error ?? "No error message"}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Backup and restore (SOP-08)">
          <KeyValue
            items={[
              ["Target RPO", "24 hours, nightly backup (proposed, agree with ATGL)"],
              ["Target RTO", "4 hours to a restored instance (proposed, agree with ATGL)"],
              ["Scope", "Configuration, application database and approved documents"],
              ["Command", <code key="b" className="text-[12.5px]">npm run backup</code>],
            ]}
          />
          <div className="mt-3">
            <Notice tone="info">
              Schedule the backup script, copy output to approved off-host storage, and run a restore test each quarter. Record the measured RPO and RTO as evidence.
            </Notice>
          </div>
        </Panel>
      </div>
    </>
  );
}
