import type { Metadata } from "next";
import type { ReactNode } from "react";
import { KeyValue, Notice, Panel, PageHeader, Tag, type Tone } from "@/components/ui";
import { AGENTS, agentById } from "@/lib/agents/definitions";
import { COPILOT_PROMPT_VERSION, NARRATIVE_PROMPT_VERSION } from "@/lib/ai/prompts";
import { CALC } from "@/lib/analytics/common";
import { can } from "@/lib/auth/rbac";
import { config, geminiConfigured } from "@/lib/config";
import { ago, dateTime, num, titleCase } from "@/lib/format";
import { latestRuns, runHistory, type AgentRun } from "@/lib/server/agents";
import { pageContext, type SearchParams } from "@/lib/server/page";
import { RunAgentButton, RunAllButton } from "./RunButtons";

export const metadata: Metadata = { title: "AI agents" };

const CALC_LABEL: Record<string, string> = {
  energySec: "Energy SEC",
  gasBalance: "Gas balance",
  uagAttribution: "UAG attribution",
  meterDrift: "Meter drift",
  assetHealth: "Asset health model",
  billingRecon: "Billing reconciliation",
  vendorSla: "Vendor SLA",
  cpCriteria: "CP criteria",
  safetyExposure: "Excavation exposure",
  opportunity: "Opportunity sizing",
};

const statusTone: Record<AgentRun["status"], Tone> = { succeeded: "ok", running: "info", failed: "crit" };

function duration(r: AgentRun): string {
  if (!r.finished_at) return "running";
  const ms = r.finished_at - r.started_at;
  return ms < 1000 ? `${num(ms)} ms` : `${num(ms / 1000, 1)} s`;
}

export default async function AgentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await pageContext("agents", searchParams);
  const latest = await latestRuns();
  const history = await runHistory(undefined, 40);
  const canRun = can(user.role, "agent.run");
  const ai = geminiConfigured();
  const agents = [...AGENTS].sort((a, b) => a.order - b.order);

  return (
    <>
      <PageHeader
        title="AI agents"
        description="Versioned rule and model pipelines over read-only data. Agents raise alerts, opportunities and data-quality issues; the language model only narrates findings, it never creates them."
        actions={canRun ? <RunAllButton /> : undefined}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel title="Agent registry" description={`${agents.length} agents, in pipeline order`} bodyClass="p-0">
          <ul>
            {agents.map((a) => {
              const r = latest.get(a.id);
              return (
                <li key={a.id} className="border-b border-line-2 px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tabular text-[12px] font-semibold text-ink-3">{a.order}.</span>
                        <h3 className="font-display text-[16px] font-semibold text-ink">{a.name}</h3>
                        <Tag>{a.version}</Tag>
                        {a.interactive && <Tag tone="info">Interactive</Tag>}
                      </div>
                      <p className="mt-1 text-[13.5px] text-ink">{a.responsibility}</p>
                      <p className="mt-0.5 text-[12.5px] text-ink-2">
                        <span className="font-semibold">Guardrail:</span> {a.guardrail}
                      </p>
                      {r ? (
                        <div className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-[12.5px]">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
                            <Tag tone={statusTone[r.status]}>{titleCase(r.status)}</Tag>
                            <span>Last run {ago(r.started_at)}</span>
                            <span>{duration(r)}</span>
                            <span>{num(r.findings)} finding{r.findings === 1 ? "" : "s"}</span>
                          </div>
                          {r.summary && <p className="mt-1 text-ink">{r.summary}</p>}
                          {r.narrative && (
                            <p className="mt-1 text-ink-2">
                              {r.narrative}
                              {r.narrative_model && <span className="ml-1 text-ink-3">({r.narrative_model})</span>}
                            </p>
                          )}
                          {r.error && <p className="mt-1 text-crit">{r.error}</p>}
                        </div>
                      ) : (
                        <p className="mt-2 text-[12.5px] text-ink-3">{a.interactive ? "Runs on demand when users ask the copilot a question." : "Not run yet."}</p>
                      )}
                    </div>
                    {canRun && a.run && <RunAgentButton agentId={a.id} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Language model" description="Used for narrative and the executive copilot only">
            <KeyValue
              items={[
                ["Status", ai ? <Tag tone="ok">Configured</Tag> : <Tag tone="warn">Not configured</Tag>],
                ["Model", <code key="m" className="text-[12.5px]">{config.gemini.model}</code>],
                ["API key", ai ? "Set in the server environment (never shown)" : "Not set"],
              ]}
            />
            {!ai && (
              <div className="mt-3">
                <Notice tone="info">Agents still run and raise findings without a model; runs simply have no narrative.</Notice>
              </div>
            )}
          </Panel>

          <Panel title="Prompt and rule versions" description="Released under SOP-05: versioned, tested against golden cases, approved, with a rollback version retained.">
            <KeyValue
              items={[
                ["Narrative prompt", <code key="n" className="text-[12.5px]">{NARRATIVE_PROMPT_VERSION}</code>],
                ["Copilot prompt", <code key="c" className="text-[12.5px]">{COPILOT_PROMPT_VERSION}</code>],
                ...Object.entries(CALC).map(([k, v]) => [CALC_LABEL[k] ?? titleCase(k),<code key={k} className="text-[12.5px]">{v}</code>] as [string, ReactNode]),
              ]}
            />
          </Panel>
        </div>
      </div>

      <Panel className="mt-4" title="Run history" description={`Last ${history.length} runs across all agents`} bodyClass="p-0">
        <div className="overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Agent</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Duration</th>
                <th scope="col" className="num">Findings</th>
                <th scope="col">Summary</th>
                <th scope="col">Triggered by</th>
                <th scope="col">Correlation ID</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{dateTime(r.started_at)}</td>
                  <td className="whitespace-nowrap">
                    {agentById.get(r.agent_id)?.name ?? r.agent_id}
                    <span className="block text-[12px] text-ink-3">{r.agent_version}</span>
                  </td>
                  <td>
                    <Tag tone={statusTone[r.status]}>{titleCase(r.status)}</Tag>
                  </td>
                  <td className="num">{duration(r)}</td>
                  <td className="num">{num(r.findings)}</td>
                  <td className="min-w-64 text-[13px] text-ink-2">
                    {r.summary ?? ""}
                    {r.narrative_model && <span className="block text-[12px] text-ink-3">Narrative: {r.narrative_model}</span>}
                    {r.error && <span className="block text-[12px] text-crit">{r.error}</span>}
                  </td>
                  <td className="whitespace-nowrap text-[13px]">{r.triggered_by}</td>
                  <td>
                    <code className="text-[12px] text-ink-3" title={r.correlation_id}>{r.correlation_id.slice(0, 8)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
