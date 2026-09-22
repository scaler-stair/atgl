import "server-only";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { hashPassword } from "../auth/password";
import type { Role } from "../auth/rbac";
import { config } from "../config";
import { all, driverName, get, run } from "./db";
import { getUser, type User } from "./users";

/**
 * Administrative SQL for user lifecycle and platform health. Callers are
 * responsible for the RBAC check (requireAction) and the audit entry.
 */

export const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,31}$/;

export async function usernameTaken(username: string): Promise<boolean> {
  return !!(await get("SELECT 1 AS x FROM users WHERE username = ?", username.toLowerCase().trim()));
}

export async function setUserStatus(id: string, status: User["status"]): Promise<void> {
  await run("UPDATE users SET status = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?", status, id);
}

export async function setTemporaryPassword(id: string, password: string): Promise<void> {
  await run(
    "UPDATE users SET password_hash = ?, must_reset = 1, failed_attempts = 0, locked_until = NULL, password_changed_at = ? WHERE id = ?",
    await hashPassword(password),
    Date.now(),
    id,
  );
}

export async function setUserRoleAndScope(id: string, role: Role, siteIds: string[] | null): Promise<void> {
  await run("UPDATE users SET role = ?, site_ids = ? WHERE id = ?", role, siteIds ? JSON.stringify(siteIds) : null, id);
}

/** Audit-safe snapshot of a user (never includes the password hash). */
export async function userSnapshot(id: string): Promise<Record<string, unknown> | null> {
  const u = await getUser(id);
  if (!u) return null;
  return { username: u.username, displayName: u.displayName, email: u.email, role: u.role, siteIds: u.siteIds, status: u.status, mustReset: u.mustReset };
}

/* ------------------------------ health ------------------------------ */

const count = async (sql: string, ...args: (string | number)[]) => Number((await get<{ n: number | null }>(sql, ...args))?.n ?? 0);

export interface HealthSnapshot {
  at: number;
  driver: "postgres" | "sqlite";
  schemaVersion: string | null;
  dbBytes: number | null;
  activeUsers: number;
  activeSessions: number;
  openAlerts: number;
  openDqIssues: number;
  runs24h: number;
  failedRuns24h: number;
  lastRunAt: number | null;
  copilot: { count: number; avgLatencyMs: number | null; groundedPct: number | null };
  login: { failures: number; lockouts: number; denied: number };
}

async function databaseBytes(): Promise<number | null> {
  if (driverName() === "postgres") {
    const r = await get<{ n: number | null }>(
      "SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0) AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'atgl' AND c.relkind = 'r'",
    );
    return r?.n === null || r?.n === undefined ? null : Number(r.n);
  }
  try {
    const path = resolve(/*turbopackIgnore: true*/ process.cwd(), config.databasePath);
    let bytes = statSync(/*turbopackIgnore: true*/ path).size;
    for (const suffix of ["-wal", "-shm"]) {
      try {
        bytes += statSync(/*turbopackIgnore: true*/ path + suffix).size;
      } catch {
        /* WAL files are optional */
      }
    }
    return bytes;
  } catch {
    return null;
  }
}

export async function healthSnapshot(now = Date.now()): Promise<HealthSnapshot> {
  const since = now - 24 * 3_600_000;
  const [schema, dbBytes, cp, lastRun] = await Promise.all([
    get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"),
    databaseBytes(),
    get<{ n: number; lat: number | null; g: number | null }>("SELECT COUNT(*) AS n, AVG(latency_ms) AS lat, AVG(grounded) AS g FROM copilot_log WHERE ts >= ?", since),
    get<{ t: number | null }>("SELECT MAX(started_at) AS t FROM agent_runs"),
  ]);
  const [activeUsers, activeSessions, openAlerts, openDqIssues, runs24h, failedRuns24h, failures, lockouts, denied] = await Promise.all([
    count("SELECT COUNT(*) AS n FROM users WHERE status = 'active'"),
    count("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?", now),
    count("SELECT COUNT(*) AS n FROM alerts WHERE status = 'open'"),
    count("SELECT COUNT(*) AS n FROM dq_issues WHERE status != 'resolved'"),
    count("SELECT COUNT(*) AS n FROM agent_runs WHERE started_at >= ?", since),
    count("SELECT COUNT(*) AS n FROM agent_runs WHERE started_at >= ? AND status = 'failed'", since),
    count("SELECT COUNT(*) AS n FROM audit_log WHERE ts >= ? AND action = 'auth.login' AND outcome = 'failure'", since),
    count("SELECT COUNT(*) AS n FROM audit_log WHERE ts >= ? AND action = 'auth.lockout'", since),
    count("SELECT COUNT(*) AS n FROM audit_log WHERE ts >= ? AND outcome = 'denied'", since),
  ]);
  const lat = cp?.lat === null || cp?.lat === undefined ? null : Number(cp.lat);
  const g = cp?.g === null || cp?.g === undefined ? null : Number(cp.g);
  return {
    at: now,
    driver: driverName(),
    schemaVersion: schema?.value ?? null,
    dbBytes,
    activeUsers,
    activeSessions,
    openAlerts,
    openDqIssues,
    runs24h,
    failedRuns24h,
    lastRunAt: lastRun?.t === null || lastRun?.t === undefined ? null : Number(lastRun.t),
    copilot: { count: Number(cp?.n ?? 0), avgLatencyMs: lat === null ? null : Math.round(lat), groundedPct: g === null ? null : g * 100 },
    login: { failures, lockouts, denied },
  };
}

export async function recentAgentFailures(limit = 10): Promise<{ id: string; agent_id: string; started_at: number; error: string | null }[]> {
  return all<{ id: string; agent_id: string; started_at: number; error: string | null }>(
    "SELECT id, agent_id, started_at, error FROM agent_runs WHERE status = 'failed' ORDER BY started_at DESC LIMIT ?",
    limit,
  );
}

/* --------------------------- time helpers --------------------------- */

/** Whole days since a credential was rotated (ISO date). */
export function credentialAgeDays(rotatedAt: string, now = Date.now()): number {
  return Math.floor((now - new Date(rotatedAt).getTime()) / 86_400_000);
}

export function isLocked(u: Pick<User, "lockedUntil">, now = Date.now()): boolean {
  return !!u.lockedUntil && u.lockedUntil > now;
}
