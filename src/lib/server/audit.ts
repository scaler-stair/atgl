import "server-only";
import { headers } from "next/headers";
import { all, run } from "./db";

/**
 * Audit trail (Section 5 and 8). Every privileged action records actor,
 * timestamp, target, before/after where applicable and a correlation ID.
 */

export interface AuditEntry {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  outcome?: "success" | "denied" | "failure";
  correlationId?: string;
  ip?: string | null;
}

export async function requestContext(): Promise<{ correlationId: string; ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    return {
      correlationId: h.get("x-correlation-id") ?? crypto.randomUUID(),
      ip: h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip"),
      userAgent: h.get("user-agent"),
    };
  } catch {
    return { correlationId: crypto.randomUUID(), ip: null, userAgent: null };
  }
}

/** Strip secrets before anything reaches the audit log. */
function redact(v: unknown): unknown {
  if (v === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) => (/password|secret|token|hash|apikey/i.test(k) ? "[redacted]" : val)),
  );
}

export async function audit(entry: AuditEntry): Promise<string> {
  const ctx = await requestContext();
  const correlationId = entry.correlationId ?? ctx.correlationId;
  await run(
    `INSERT INTO audit_log (ts, actor_id, actor_name, action, target_type, target_id, before_json, after_json, outcome, correlation_id, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Date.now(),
    entry.actorId ?? null,
    entry.actorName ?? null,
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.before === undefined ? null : JSON.stringify(redact(entry.before)),
    entry.after === undefined ? null : JSON.stringify(redact(entry.after)),
    entry.outcome ?? "success",
    correlationId,
    entry.ip ?? ctx.ip ?? null,
  );
  return correlationId;
}

export interface AuditRow {
  id: number;
  ts: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before_json: string | null;
  after_json: string | null;
  outcome: string;
  correlation_id: string;
  ip: string | null;
}

export async function listAudit(opts: { limit?: number; action?: string; actor?: string } = {}): Promise<AuditRow[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.action) {
    where.push("action LIKE ?");
    args.push(`${opts.action}%`);
  }
  if (opts.actor) {
    where.push("(LOWER(actor_name) LIKE LOWER(?) OR actor_id = ?)");
    args.push(`%${opts.actor}%`, opts.actor);
  }
  args.push(opts.limit ?? 200);
  return all<AuditRow>(`SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ts DESC, id DESC LIMIT ?`, ...args);
}
