import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { agentById } from "@/lib/agents/definitions";
import { audit, requestContext } from "@/lib/server/audit";
import { runAgent, runAllAgents } from "@/lib/server/agents";

/**
 * Scheduler entry point (cron / orchestrator). Authenticated with a service
 * token that is separate from human credentials (Section 5).
 *   curl -X POST -H "Authorization: Bearer $AGENT_SCHEDULER_TOKEN" /api/agents/run?agent=energy
 *
 * GET is the same call for schedulers that can only issue GET (Vercel Cron,
 * which sends Authorization: Bearer $CRON_SECRET).
 */
export const maxDuration = 60;

function matches(expected: string, got: string): boolean {
  if (expected.length < 24 || !got) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(got).digest();
  return timingSafeEqual(a, b);
}

function authorised(req: Request): boolean {
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return matches(process.env.AGENT_SCHEDULER_TOKEN ?? "", got) || matches(process.env.CRON_SECRET ?? "", got);
}

export async function GET(req: Request) {
  return POST(req);
}

export async function POST(req: Request) {
  const { correlationId } = await requestContext();
  if (!authorised(req)) {
    await audit({ actorName: "scheduler", action: "agent.run", targetType: "agent", outcome: "denied", correlationId });
    return NextResponse.json({ error: "Invalid scheduler token" }, { status: 401 });
  }
  const agent = new URL(req.url).searchParams.get("agent");
  if (agent && !agentById.get(agent)?.run) return NextResponse.json({ error: `Unknown batch agent ${agent}` }, { status: 400 });
  const runs = agent ? [await runAgent(agent, "service:scheduler", correlationId)] : await runAllAgents("service:scheduler", correlationId);
  await audit({ actorName: "service:scheduler", action: "agent.run", targetType: "agent", targetId: agent ?? "all", after: runs.map((r) => ({ agent: r.agent_id, status: r.status, findings: r.findings })), correlationId });
  const failed = runs.filter((r) => r.status !== "succeeded");
  return NextResponse.json(
    { correlationId, runs: runs.map((r) => ({ id: r.id, agent: r.agent_id, version: r.agent_version, status: r.status, findings: r.findings, error: r.error })) },
    { status: failed.length ? 207 : 200 },
  );
}
