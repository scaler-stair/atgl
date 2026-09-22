"use server";

import { revalidatePath } from "next/cache";
import { agentById } from "@/lib/agents/definitions";
import { audit, requestContext } from "@/lib/server/audit";
import { runAgent, runAllAgents } from "@/lib/server/agents";
import { requireAction } from "@/lib/server/session";

export type ActionState = { error?: string; ok?: string; secret?: string } | undefined;

export async function runAgentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const id = String(form.get("agentId") ?? "");
    const user = await requireAction("agent.run", id);
    const def = agentById.get(id);
    if (!def || !def.run) return { error: "That agent can't be run on demand. Pick a batch agent from the list." };
    const { correlationId } = await requestContext();
    const run = await runAgent(id, `user:${user.username}`, correlationId);
    await audit({
      actorId: user.id,
      actorName: user.displayName,
      action: "agent.run",
      targetType: "agent",
      targetId: id,
      after: { runId: run.id, status: run.status, findings: run.findings, version: run.agent_version },
      outcome: run.status === "failed" ? "failure" : "success",
      correlationId,
    });
    revalidatePath("/agents");
    if (run.status === "failed") return { error: `${def.name} failed: ${run.error ?? "unknown error"}. Check the run history for details.` };
    return { ok: `${def.name} ran: ${run.findings} finding${run.findings === 1 ? "" : "s"}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function runAllAgentsAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  void _form;
  try {
    const user = await requireAction("agent.run", "all");
    const { correlationId } = await requestContext();
    const runs = await runAllAgents(`user:${user.username}`, correlationId);
    const failed = runs.filter((r) => r.status === "failed");
    await audit({
      actorId: user.id,
      actorName: user.displayName,
      action: "agent.run",
      targetType: "agent",
      targetId: "all",
      after: { runs: runs.map((r) => ({ agent: r.agent_id, runId: r.id, status: r.status, findings: r.findings })) },
      outcome: failed.length ? "failure" : "success",
      correlationId,
    });
    revalidatePath("/agents");
    if (failed.length) return { error: `${failed.length} of ${runs.length} agents failed: ${failed.map((r) => r.agent_id).join(", ")}. Check the run history.` };
    return { ok: `All ${runs.length} agents ran: ${runs.reduce((t, r) => t + r.findings, 0)} findings.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
