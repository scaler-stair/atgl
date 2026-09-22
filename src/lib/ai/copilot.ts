import "server-only";
import { ThinkingLevel, type Content, type Part } from "@google/genai";
import { round, scopeLabel } from "../analytics/common";
import { ROLE_LABEL } from "../auth/rbac";
import { config } from "../config";
import type { Scope } from "../domain/types";
import { newId, run } from "../server/db";
import type { User } from "../server/users";
import { gemini, geminiModel, generateWithFallback } from "./gemini";
import { COPILOT_PROMPT_VERSION, copilotSystem } from "./prompts";
import { executeTool, fmtInr, TOOL_DECLARATIONS, type ToolCallRecord } from "./tools";

export interface CopilotTurn {
  role: "user" | "assistant";
  text: string;
}

export interface CopilotAnswer {
  answer: string;
  toolCalls: ToolCallRecord[];
  model: string;
  promptVersion: string;
  grounded: boolean;
  refused: boolean;
  correlationId: string;
  latencyMs: number;
}

/**
 * Hard guard, independent of the model: the platform never controls OT.
 * Matches imperative requests ("stop compressor 2", "can you raise the
 * set-point") but not analytical questions ("why did UAG increase at the station?").
 */
const CONTROL_INTENT =
  /(?:^|[.!?;]\s*|\b(?:please|pls|kindly|can you|could you|would you|will you|go ahead and|i want you to|i need you to|you should|let's|lets)\s+)(?:please\s+)?(start|stop|shut\s*down|shutdown|trip|restart|isolate|open|close|turn\s+(?:on|off)|switch\s+(?:on|off)|increase|decrease|raise|lower|change|adjust|write|set|reset|override|bypass)\b[^.?!]{0,60}\b(compressor|valve|pump|motor|set\s*-?\s*points?|setpoints?|pressure|flow|scada|rtu|plc|station|dispenser|rectifier|breaker|odori[sz]er)s?\b/i;

export function isControlRequest(q: string): boolean {
  return CONTROL_INTENT.test(q);
}

export const REFUSAL =
  "I can't do that. This platform is read-only by design: it observes, analyses and recommends, and it never sends commands to SCADA, RTUs or station equipment. Any change to equipment or set-points must go through the station's approved operating procedure and control-room authority.\n\nI can show the current condition, trend and evidence for that equipment, or list the open recommendations for it.";

const MAX_ROUNDS = 5;
const COPILOT_BUDGET_MS = 50_000;

export async function askCopilot(user: User, base: Scope, question: string, history: CopilotTurn[], correlationId: string): Promise<CopilotAnswer> {
  const started = Date.now();
  const q = question.trim().slice(0, 2000);
  let out: Omit<CopilotAnswer, "latencyMs" | "correlationId">;

  if (isControlRequest(q)) {
    out = { answer: REFUSAL, toolCalls: [], model: "policy-guard", promptVersion: COPILOT_PROMPT_VERSION, grounded: true, refused: true };
  } else if (gemini()) {
    try {
      out = await geminiAnswer(user, base, q, history);
    } catch (e) {
      const fb = await fallbackAnswer(user, base, q);
      out = { ...fb, answer: `${fb.answer}\n\n_Gemini was unavailable (${(e as Error).message.slice(0, 120)}); this answer was produced by the deterministic grounded responder._` };
    }
  } else {
    out = await fallbackAnswer(user, base, q);
  }

  const latencyMs = Date.now() - started;
  await run(
    "INSERT INTO copilot_log (id, ts, user_id, question, answer, tool_calls_json, model, prompt_version, grounded, latency_ms, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    newId("cop"), Date.now(), user.id, q, out.answer, JSON.stringify(out.toolCalls), out.model, out.promptVersion, out.grounded ? 1 : 0, latencyMs, correlationId);
  return { ...out, correlationId, latencyMs };
}

async function geminiAnswer(user: User, base: Scope, q: string, history: CopilotTurn[]): Promise<Omit<CopilotAnswer, "latencyMs" | "correlationId">> {
  const contents: Content[] = [
    ...history.slice(-8).map((t) => ({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.text.slice(0, 4000) }] })),
    { role: "user", parts: [{ text: q }] },
  ];
  const system = copilotSystem({
    userName: user.displayName,
    role: ROLE_LABEL[user.role],
    scopeLabel: scopeLabel(base),
    today: new Date().toLocaleDateString("en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" }),
    environment: `${config.appEnv} (${config.dataMode} data)`,
  });
  const calls: ToolCallRecord[] = [];
  let usedModel = geminiModel();
  // One budget for the whole answer; past it the caller falls back to the grounded responder.
  const deadline = Date.now() + COPILOT_BUDGET_MS;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { res, model } = await generateWithFallback(
      { contents, config: { systemInstruction: system, temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, tools: [{ functionDeclarations: TOOL_DECLARATIONS }] } },
      30_000,
      "Copilot request",
      deadline,
    );
    usedModel = model;
    const fcs = res.functionCalls ?? [];
    if (fcs.length === 0) {
      const text = res.text?.trim() || "No answer was produced. Try rephrasing the question.";
      return { answer: text, toolCalls: calls, model: usedModel, promptVersion: COPILOT_PROMPT_VERSION, grounded: calls.some((c) => c.ok), refused: false };
    }
    const modelContent = res.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);
    const responses: Part[] = [];
    for (const fc of fcs) {
      const { result, record } = await executeTool(fc.name ?? "", (fc.args ?? {}) as Record<string, unknown>, { user, base });
      calls.push(record);
      responses.push({ functionResponse: { id: fc.id, name: fc.name, response: result as Record<string, unknown> } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return { answer: "The question needed more lookups than allowed in one turn. Narrow it to a zone, site or domain.", toolCalls: calls, model: geminiModel(), promptVersion: COPILOT_PROMPT_VERSION, grounded: false, refused: false };
}

/* ---------------------------------------------------------------------- */
/* Deterministic grounded responder: used when no Gemini key is configured */
/* or the model is unavailable. Same tools, same evidence, templated text. */
/* ---------------------------------------------------------------------- */

type Data = Record<string, unknown> & { data: never; evidence: import("../domain/types").Evidence | null; scope: string };

function sourcesLine(r: Data): string {
  const e = r.evidence;
  if (!e) return `**Sources:** scope ${r.scope}; live workflow tables.`;
  return `**Sources:** ${e.window.label}, ${r.scope}; ${e.sources.join(", ")}; data quality ${e.quality}, as of ${new Date(e.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST; ${e.version}.`;
}

function detectZone(q: string): string | undefined {
  const m: Record<string, string> = { ahmedabad: "AHD", vadodara: "VAD", baroda: "VAD", faridabad: "FBD", khurja: "KHJ", udaipur: "UDR" };
  for (const [k, v] of Object.entries(m)) if (q.toLowerCase().includes(k)) return v;
  const id = q.match(/\b(AHD|VAD|FBD|KHJ|UDR)\b/);
  return id?.[1];
}

function detectWindow(q: string): string {
  if (/24\s*h|today|yesterday|last day/i.test(q)) return "24h";
  if (/30|month/i.test(q)) return "30d";
  return "7d";
}

async function fallbackAnswer(user: User, base: Scope, q: string): Promise<Omit<CopilotAnswer, "latencyMs" | "correlationId">> {
  const zone = detectZone(q);
  const window = detectWindow(q);
  const site = q.match(/\b[A-Z]{3}-(?:CGS|MS|OS|DB|OFF)-\d{2}\b/)?.[0];
  const calls: ToolCallRecord[] = [];
  const lookup = async (name: string, args: Record<string, unknown>) => {
    const { result, record } = await executeTool(name, args, { user, base });
    calls.push(record);
    return result as Data;
  };
  const lc = q.toLowerCase();
  let answer: string;

  if (/uag|unaccounted|gas balance|linepack|cascade/.test(lc)) {
    const r = await lookup("get_gas_balance", { window, zone });
    const d = r.data as unknown as { uagPct: number; uagScm: number; uagValueInrIndicative: number; zones: { zoneName: string; uagPct: number; attribution: Record<string, number>; uagScm: number }[] };
    const top = d.zones[0];
    const attr = top ? Object.entries(top.attribution).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${round((v / top.uagScm) * 100)}%`).join(", ") : "";
    answer = `UAG is **${d.uagPct}%** (${d.uagScm.toLocaleString("en-IN")} SCM, about ${fmtInr(d.uagValueInrIndicative)} indicative) for ${r.scope}.\n\n${d.zones.map((z) => `- ${z.zoneName}: ${z.uagPct}%`).join("\n")}${top ? `\n\n${top.zoneName} is highest; attribution: ${attr}. Attribution uses the documented assumptions (check-meter drift, leak findings, billing lag, AGA-8 linepack).` : ""}`;
    answer += `\n\n${sourcesLine(r)}`;
  } else if (/energy|sec\b|kwh|specific energy|compressor efficiency|power/.test(lc)) {
    const r = await lookup("get_energy", { window, zone, site });
    const d = r.data as unknown as { totalKwh: number; networkSecKwhPerKg: number; benchmarkSecKwhPerKg: number; excessKwh: number; excessInrIndicative: number; stationsWorstFirst: { siteName: string; secKwhPerKg: number; benchmarkGapPct: number }[] };
    answer = `Network specific energy is **${d.networkSecKwhPerKg} kWh/kg** against a best-quartile benchmark of ${d.benchmarkSecKwhPerKg} kWh/kg; total ${d.totalKwh.toLocaleString("en-IN")} kWh.\n\nExcess over benchmark: ${d.excessKwh.toLocaleString("en-IN")} kWh (${fmtInr(d.excessInrIndicative)}, indicative).\n\n${d.stationsWorstFirst.slice(0, 4).map((s) => `- ${s.siteName}: ${s.secKwhPerKg} kWh/kg (${s.benchmarkGapPct > 0 ? "+" : ""}${s.benchmarkGapPct}% vs benchmark)`).join("\n")}\n\n${sourcesLine(r)}`;
  } else if (/meter|drift|calibrat|fiscal/.test(lc)) {
    const r = await lookup("get_metering", { zone, site });
    const d = r.data as unknown as { counts: Record<string, number>; exposureInrPerDayIndicative: number; exceptions: { meterId: string; status: string; reasons: string[] }[] };
    answer = `${d.counts.fault} meter(s) in fault and ${d.counts.watch} on watch; indicative revenue exposure ${fmtInr(d.exposureInrPerDayIndicative)} per day.\n\n${d.exceptions.slice(0, 5).map((m) => `- ${m.meterId} (${m.status}): ${m.reasons.join("; ")}`).join("\n")}\n\n${sourcesLine(r)}`;
  } else if (/asset|reliab|health|vibration|compressor|motor|breakdown|maintenance/.test(lc)) {
    const r = await lookup("get_asset_health", { zone, site });
    const d = r.data as unknown as { counts: Record<string, number>; assetsWorstFirst: { assetId: string; siteName: string; name: string; health: number; findings: string[]; confidence: number }[] };
    answer = `${d.counts.alert} asset(s) in alert and ${d.counts.watch} on watch. These are advisory predictions.\n\n${d.assetsWorstFirst.slice(0, 4).map((a) => `- ${a.siteName}, ${a.name} (${a.assetId}): health ${a.health}/100, confidence ${Math.round(a.confidence * 100)}%. ${a.findings[0] ?? ""}`).join("\n")}\n\n${sourcesLine(r)}`;
  } else if (/bill|discom|tariff|demand charge|power factor/.test(lc)) {
    const r = await lookup("get_billing_exceptions", { zone, site });
    const d = r.data as unknown as { atStakeInrPendingReview: number; exceptions: { siteName: string; month: string; detail: string; amountAtStakeInr: number }[] };
    answer = `${d.exceptions.length} billing exception(s) with ${fmtInr(d.atStakeInrPendingReview)} at stake, pending review before any financial action.\n\n${d.exceptions.slice(0, 5).map((x) => `- ${x.siteName} (${x.month}): ${x.detail}; ${fmtInr(x.amountAtStakeInr)}`).join("\n")}\n\n${sourcesLine(r)}`;
  } else if (/vendor|amc|sla|contract/.test(lc)) {
    const r = await lookup("get_vendor_performance", {});
    const d = r.data as unknown as { vendor: string; status: string; slaCompliancePct: number | null; flags: string[] }[];
    answer = `${d.filter((v) => v.status !== "on-track").length} of ${d.length} AMC contracts need attention.\n\n${d.filter((v) => v.status !== "on-track").map((v) => `- ${v.vendor} (${v.status}): ${v.flags.join("; ")}`).join("\n")}\n\n${sourcesLine(r)}`;
  } else if (/safety|cp\b|cathodic|excavat|leak|patrol|integrity/.test(lc)) {
    const r = await lookup("get_safety", { window, zone });
    const d = r.data as unknown as { cpCompliancePct: number; openHighEvents: number; unpermittedExcavations: number; patrolCoveragePct: number; openEvents: { description: string; severity: string }[] };
    answer = `CP compliance is **${d.cpCompliancePct}%**; ${d.openHighEvents} open high-severity event(s); ${d.unpermittedExcavations} unpermitted excavation(s); patrol coverage ${d.patrolCoveragePct}% in the last 7 days.\n\n${d.openEvents.slice(0, 5).map((e) => `- (${e.severity}) ${e.description}`).join("\n")}\n\n${sourcesLine(r)}`;
  } else if (/opportunit|saving|value|rupee|₹|business case/.test(lc)) {
    const r = await lookup("get_opportunities", { zone });
    const d = r.data as unknown as { count: number; totalIndicativeInr: number; totalValidatedInr: number; items: { title: string; valueInr: number; valueState: string; status: string }[] };
    answer = `${d.count} opportunities: ${fmtInr(d.totalIndicativeInr)} indicative and ${fmtInr(d.totalValidatedInr)} validated.\n\n${d.items.slice(0, 5).map((o) => `- ${o.title}: ${fmtInr(o.valueInr)} (${o.valueState}, ${o.status})`).join("\n")}\n\n${sourcesLine(r)}`;
  } else if (/alert|alarm|attention|urgent/.test(lc)) {
    const r = await lookup("get_alerts", { status: "open" });
    const d = r.data as unknown as { severity: string; title: string; routedTo: string }[];
    answer = `${d.length} open alert(s) in your scope.\n\n${d.slice(0, 6).map((a) => `- (${a.severity}) ${a.title}; routed to ${a.routedTo.replace("_", " ")}`).join("\n")}\n\n${sourcesLine(r)}`;
  } else if (/data quality|stale|fresh|missing|connector|feed/.test(lc)) {
    const r = await lookup("get_data_quality", {});
    const d = r.data as unknown as { sources: { name: string; state: string; lagMinutes: number }[]; openIssues: { entity: string; kind: string; detail: string }[] };
    answer = `${d.sources.filter((s) => s.state !== "healthy").length} source(s) degraded; ${d.openIssues.length} open data-quality issue(s).\n\n${d.openIssues.slice(0, 5).map((i) => `- ${i.entity} (${i.kind}): ${i.detail}`).join("\n")}\n\n${sourcesLine(r)}`;
  } else {
    const r = await lookup("get_overview", { window, zone, site });
    const d = r.data as unknown as import("../analytics/overview").Overview;
    answer = `Here is the ${r.scope} position (${(r.evidence?.window.label ?? "last 7 days").toLowerCase()}):\n\n- Energy: SEC ${d.energy.networkSec} kWh/kg vs benchmark ${d.energy.benchmarkSec}; excess ${fmtInr(d.energy.excessInr)} indicative\n- Gas: UAG ${d.gas.uagPct}% (${d.gas.uagScm.toLocaleString("en-IN")} SCM)\n- Metering: ${d.metering.counts.fault} fault, ${d.metering.counts.watch} watch\n- Reliability: ${d.reliability.counts.alert} assets in alert\n- Billing: ${d.billing.exceptions} exceptions, ${fmtInr(d.billing.atStakeInr)} at stake\n- Safety: CP ${d.safety.cpCompliancePct}% compliant, ${d.safety.openHighEvents} open high-severity events\n\n${sourcesLine(r)}`;
  }
  return {
    answer: `${answer}\n\n_Deterministic grounded responder (set GEMINI_API_KEY for conversational answers)._`,
    toolCalls: calls,
    model: "grounded-template@1.0.0",
    promptVersion: COPILOT_PROMPT_VERSION,
    grounded: calls.some((c) => c.ok),
    refused: false,
  };
}
