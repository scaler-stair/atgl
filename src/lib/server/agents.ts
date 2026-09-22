import "server-only";
import { AGENTS, agentById, type AgentOutput, type Finding } from "../agents/definitions";
import { ThinkingLevel } from "@google/genai";
import { gemini, generateWithFallback } from "../ai/gemini";
import { NARRATIVE_PROMPT_VERSION, NARRATIVE_SYSTEM } from "../ai/prompts";
import { all, get, newId, run, tx } from "./db";

export interface AgentRun {
  id: string;
  agent_id: string;
  agent_version: string;
  started_at: number;
  finished_at: number | null;
  status: "running" | "succeeded" | "failed";
  findings: number;
  summary: string | null;
  narrative: string | null;
  narrative_model: string | null;
  error: string | null;
  triggered_by: string;
  correlation_id: string;
}

const UPSERT_ALERT = `
    INSERT INTO alerts (id, dedupe_key, domain, severity, site_id, zone_id, title, detail, evidence_json, route_role, status, source_agent, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      severity = excluded.severity, title = excluded.title, detail = excluded.detail,
      evidence_json = excluded.evidence_json, last_seen_at = excluded.last_seen_at`;

const UPSERT_OPPORTUNITY = `
    INSERT INTO opportunities (id, dedupe_key, domain, title, site_id, zone_id, impact_inr, impact_basis, recommendation, owner_role, evidence_json, status, validation, source_agent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'identified', 'indicative', ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      title = excluded.title,
      impact_inr = CASE WHEN opportunities.validation = 'indicative' THEN excluded.impact_inr ELSE opportunities.impact_inr END,
      impact_basis = CASE WHEN opportunities.validation = 'indicative' THEN excluded.impact_basis ELSE opportunities.impact_basis END,
      evidence_json = excluded.evidence_json`;

const UPSERT_DQ = `
    INSERT INTO dq_issues (id, dedupe_key, source, entity, kind, detail, severity, status, owner_role, detected_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      detail = excluded.detail, severity = excluded.severity, last_seen_at = excluded.last_seen_at,
      status = CASE WHEN dq_issues.status = 'resolved' AND dq_issues.resolved_at < excluded.last_seen_at - 3600000 THEN 'open' ELSE dq_issues.status END`;

async function persistFindings(agentId: string, findings: Finding[]): Promise<void> {
  const now = Date.now();
  await tx(async (t) => {
    for (const f of findings) {
      const ev = JSON.stringify(f.evidence);
      if (f.alert) {
        await t.run(UPSERT_ALERT, newId("alr"), f.key, f.domain, f.severity, f.siteId ?? null, f.zoneId ?? null, f.title, f.detail, ev, f.alert.routeRole, agentId, now, now);
      }
      if (f.opportunity) {
        await t.run(UPSERT_OPPORTUNITY, newId("opp"), f.key, f.domain, f.title, f.siteId ?? null, f.zoneId ?? null, f.opportunity.impactInr, f.opportunity.basis, f.opportunity.recommendation, f.opportunity.ownerRole, ev, agentId, now, now);
      }
      if (f.dq) {
        await t.run(UPSERT_DQ, newId("dq"), f.key, f.dq.source, f.dq.entity, f.dq.kind, f.detail, f.severity, f.alert?.routeRole ?? "operations", now, now);
      }
    }
  });
}

async function narrate(agentName: string, version: string, output: AgentOutput): Promise<{ text: string; model: string } | null> {
  const ai = gemini();
  if (!ai || output.findings.length === 0) return null;
  const payload = {
    agent: agentName,
    agentVersion: version,
    summary: output.summary,
    findings: output.findings.slice(0, 12).map((f) => ({
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      window: f.evidence.window.label,
      version: f.evidence.version,
      quality: f.evidence.quality,
      indicativeValueInr: f.opportunity?.impactInr,
    })),
  };
  const { res, model } = await generateWithFallback(
    {
      contents: JSON.stringify(payload),
      // Thinking tokens count against the output budget on Gemini 3.x; keep thinking low and the budget roomy.
      config: { systemInstruction: NARRATIVE_SYSTEM, temperature: 0.2, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    },
    60_000,
    "Narrative generation",
  );
  const text = res.text?.trim();
  return text ? { text, model: `${model} / ${NARRATIVE_PROMPT_VERSION}` } : null;
}

export async function runAgent(agentId: string, triggeredBy: string, correlationId: string, opts: { narrative?: boolean } = {}): Promise<AgentRun> {
  const def = agentById.get(agentId);
  if (!def || !def.run) throw new Error(`Agent ${agentId} is not a batch agent.`);
  const id = newId("run");
  const started = Date.now();
  await run("INSERT INTO agent_runs (id, agent_id, agent_version, started_at, status, triggered_by, correlation_id) VALUES (?, ?, ?, ?, 'running', ?, ?)", id, def.id, def.version, started, triggeredBy, correlationId);
  try {
    const output = def.run();
    await persistFindings(def.id, output.findings);
    let narrative: { text: string; model: string } | null = null;
    let narrativeError: string | null = null;
    if (opts.narrative !== false) {
      try {
        narrative = await narrate(def.name, def.version, output);
      } catch (e) {
        narrativeError = `Narrative skipped: ${(e as Error).message}`;
      }
    }
    await run(
      "UPDATE agent_runs SET finished_at = ?, status = 'succeeded', findings = ?, summary = ?, narrative = ?, narrative_model = ?, output_json = ?, error = ? WHERE id = ?",
      Date.now(), output.findings.length, output.summary, narrative?.text ?? null, narrative?.model ?? null, JSON.stringify(output.findings), narrativeError, id);
  } catch (e) {
    await run("UPDATE agent_runs SET finished_at = ?, status = 'failed', error = ? WHERE id = ?", Date.now(), (e as Error).message, id);
  }
  return (await get<AgentRun>("SELECT * FROM agent_runs WHERE id = ?", id))!;
}

export async function runAllAgents(triggeredBy: string, correlationId: string, opts: { narrative?: boolean } = {}): Promise<AgentRun[]> {
  const out: AgentRun[] = [];
  for (const a of AGENTS.filter((x) => x.run)) out.push(await runAgent(a.id, triggeredBy, correlationId, opts));
  return out;
}

let bootstrapping: Promise<void> | null = null;
let bootstrapped = false;

/** First-boot: populate the workflow tables so dashboards are never empty. */
export async function ensureAgentsBootstrapped(): Promise<void> {
  if (bootstrapped) return;
  const n = Number((await get<{ n: number }>("SELECT COUNT(*) AS n FROM agent_runs"))?.n ?? 0);
  if (n > 0) {
    bootstrapped = true;
    return;
  }
  bootstrapping ??= runAllAgents("system:bootstrap", crypto.randomUUID(), { narrative: false })
    .then(() => {
      bootstrapped = true;
    })
    .finally(() => {
      bootstrapping = null;
    });
  return bootstrapping;
}

export async function latestRuns(): Promise<Map<string, AgentRun>> {
  const rows = await all<AgentRun>(
    "SELECT r.* FROM agent_runs r JOIN (SELECT agent_id, MAX(started_at) AS m FROM agent_runs GROUP BY agent_id) x ON x.agent_id = r.agent_id AND x.m = r.started_at",
  );
  return new Map(rows.map((r) => [r.agent_id, r]));
}

export async function runHistory(agentId?: string, limit = 30): Promise<AgentRun[]> {
  return agentId
    ? all<AgentRun>("SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?", agentId, limit)
    : all<AgentRun>("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?", limit);
}
