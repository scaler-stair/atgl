import { NextResponse } from "next/server";
import { z } from "zod";
import { askCopilot } from "@/lib/ai/copilot";
import { canView } from "@/lib/auth/rbac";
import { audit, requestContext } from "@/lib/server/audit";
import { run } from "@/lib/server/db";
import { currentUser, scopeFor } from "@/lib/server/session";

const Body = z.object({
  question: z.string().trim().min(2).max(2000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) })).max(20).default([]),
  zone: z.string().max(8).optional(),
  site: z.string().max(20).optional(),
});

// Gemini answers can take up to the copilot budget (50 s) plus lookups.
export const maxDuration = 60;

const WINDOW_MS = 60_000;
const LIMIT = 12;
const hits = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > LIMIT;
}

export async function POST(req: Request) {
  const started = Date.now();
  const { correlationId } = await requestContext();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to use the copilot." }, { status: 401 });
  if (!canView(user.role, "copilot")) {
    await audit({ actorId: user.id, actorName: user.displayName, action: "copilot.ask", outcome: "denied", correlationId });
    return NextResponse.json({ error: "Your role does not include the executive copilot." }, { status: 403 });
  }
  if (rateLimited(user.id)) return NextResponse.json({ error: `Limit of ${LIMIT} questions per minute reached. Wait a moment and ask again.` }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ask a question between 2 and 2,000 characters." }, { status: 400 });

  const { question, history, zone, site } = parsed.data;
  const answer = await askCopilot(user, scopeFor(user, { zone, site }), question, history, correlationId);
  await run("INSERT INTO request_metrics (ts, route, status, latency_ms) VALUES (?, ?, ?, ?)", Date.now(), "/api/copilot", 200, Date.now() - started);
  return NextResponse.json(answer, { headers: { "x-correlation-id": correlationId } });
}
