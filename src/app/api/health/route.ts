import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { connectorStatuses } from "@/lib/connectors";
import { healthSnapshot } from "@/lib/server/admin";
import { requestContext } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness and readiness probe for monitoring. Returns only
 * aggregate counts and states: no user names, IPs, secrets or business data.
 */
export async function GET() {
  const { correlationId } = await requestContext();
  const now = Date.now();
  try {
    const h = await healthSnapshot(now);
    const connectors = connectorStatuses(now).map((c) => ({ id: c.id, state: c.state, lagMinutes: c.lagMinutes, expectedFreshnessMin: c.expectedFreshnessMin }));
    const lastRunAgeMin = h.lastRunAt ? Math.round((now - h.lastRunAt) / 60_000) : null;
    const checks = {
      database: { ok: true, schemaVersion: h.schemaVersion },
      connectors: { ok: connectors.every((c) => c.state === "healthy"), items: connectors },
      agents: { ok: h.failedRuns24h === 0 && lastRunAgeMin !== null && lastRunAgeMin <= 6 * 60, runs24h: h.runs24h, failed24h: h.failedRuns24h, lastRunAgeMin },
      workflow: { openAlerts: h.openAlerts, openDqIssues: h.openDqIssues },
    };
    const status = checks.connectors.ok && checks.agents.ok ? "ok" : "degraded";
    return NextResponse.json(
      { status, environment: config.appEnv, dataMode: config.dataMode, time: new Date(now).toISOString(), checks, correlationId },
      { headers: { "cache-control": "no-store", "x-correlation-id": correlationId } },
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", checks: { database: { ok: false } }, correlationId },
      { status: 503, headers: { "cache-control": "no-store", "x-correlation-id": correlationId } },
    );
  }
}
