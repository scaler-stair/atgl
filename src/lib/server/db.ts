import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Pool, PoolClient } from "pg";
import { config } from "../config";

/**
 * Application database (users, sessions, audit, alerts, opportunities, agent
 * runs, data-quality queue). It never stores or proxies OT writes: it only
 * holds the intelligence layer's own workflow state.
 *
 * Two drivers behind one async API:
 *  - PostgreSQL (Neon, or any Postgres) when DATABASE_URL is set. Tables live
 *    in a private `atgl` schema with row-level security enabled, so a hosted
 *    data API (such as the Neon Data API) cannot read them even if enabled;
 *    the app connects as the table owner.
 *  - SQLite (node:sqlite) otherwise, for local development and tests.
 * Statements use `?` placeholders; the Postgres adapter rewrites them to $n.
 */

export type Param = string | number | null;
type Row = Record<string, unknown>;

export interface Queryable {
  all<T = Row>(sql: string, ...params: Param[]): Promise<T[]>;
  get<T = Row>(sql: string, ...params: Param[]): Promise<T | undefined>;
  run(sql: string, ...params: Param[]): Promise<number>;
}

const SCHEMA_VERSION = 4;
const PG_SCHEMA = config.databaseSchema.replace(/[^a-z0-9_]/gi, "") || "atgl";

const TABLES = ["meta", "users", "sessions", "audit_log", "alerts", "opportunities", "agent_runs", "dq_issues", "copilot_log", "request_metrics"];

/** DDL shared by both drivers. {SERIAL_PK} differs per dialect. */
const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  site_ids TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  must_reset INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT,
  password_changed_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  last_login_at BIGINT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id {SERIAL_PK},
  ts BIGINT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  before_json TEXT,
  after_json TEXT,
  outcome TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  severity TEXT NOT NULL,
  site_id TEXT,
  zone_id TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  route_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  source_agent TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  ack_by TEXT, ack_at BIGINT,
  closed_by TEXT, closed_at BIGINT,
  action_note TEXT,
  closure_evidence TEXT
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  site_id TEXT,
  zone_id TEXT,
  impact_inr BIGINT NOT NULL,
  impact_basis TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  owner_id TEXT,
  owner_role TEXT,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'identified',
  validation TEXT NOT NULL DEFAULT 'indicative',
  validated_by TEXT, validated_at BIGINT, validated_value_inr BIGINT,
  source_agent TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  finished_at BIGINT,
  status TEXT NOT NULL,
  findings INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  narrative TEXT,
  narrative_model TEXT,
  output_json TEXT,
  error TEXT,
  triggered_by TEXT NOT NULL,
  correlation_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_id, started_at DESC);

CREATE TABLE IF NOT EXISTS dq_issues (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  entity TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  owner_id TEXT,
  owner_role TEXT,
  resolution TEXT,
  detected_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  resolved_at BIGINT
);

CREATE TABLE IF NOT EXISTS copilot_log (
  id TEXT PRIMARY KEY,
  ts BIGINT NOT NULL,
  user_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  tool_calls_json TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  grounded INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  correlation_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_metrics (
  id {SERIAL_PK},
  ts BIGINT NOT NULL,
  route TEXT NOT NULL,
  status INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_ts ON request_metrics(ts DESC);
`;

export function usingPostgres(): boolean {
  return /^postgres(ql)?:\/\//.test(config.databaseUrl);
}

export function driverName(): "postgres" | "sqlite" {
  return usingPostgres() ? "postgres" : "sqlite";
}

/* ------------------------------ Postgres ------------------------------ */

/** Rewrite `?` placeholders to $1..$n, skipping quoted literals. */
export function toPgPlaceholders(sql: string): string {
  let n = 0;
  let out = "";
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === "?") {
      out += `$${++n}`;
    } else out += ch;
  }
  return out;
}

function pgQueryable(c: Pool | PoolClient): Queryable {
  return {
    async all<T>(sql: string, ...params: Param[]) {
      return (await c.query(toPgPlaceholders(sql), params)).rows as T[];
    },
    async get<T>(sql: string, ...params: Param[]) {
      return (await c.query(toPgPlaceholders(sql), params)).rows[0] as T | undefined;
    },
    async run(sql: string, ...params: Param[]) {
      return (await c.query(toPgPlaceholders(sql), params)).rowCount ?? 0;
    },
  };
}

/* ------------------------------- SQLite ------------------------------- */

function sqliteQueryable(conn: DatabaseSync): Queryable {
  return {
    async all<T>(sql: string, ...params: Param[]) {
      return conn.prepare(sql).all(...params) as unknown as T[];
    },
    async get<T>(sql: string, ...params: Param[]) {
      return conn.prepare(sql).get(...params) as T | undefined;
    },
    async run(sql: string, ...params: Param[]) {
      return Number(conn.prepare(sql).run(...params).changes);
    },
  };
}

/* ------------------------------ lifecycle ------------------------------ */

interface Handle {
  q: Queryable;
  tx<T>(fn: (t: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const g = globalThis as unknown as { __atglDb?: Promise<Handle> };

async function openPostgres(): Promise<Handle> {
  const pg = (await import("pg")).default;
  // BIGINT (int8) and NUMERIC come back as strings by default; timestamps here are epoch ms.
  pg.types.setTypeParser(20, (v: string) => Number(v));
  pg.types.setTypeParser(1700, (v: string) => Number(v));
  const url = new URL(config.databaseUrl);
  const pooled = /-pooler\./.test(url.hostname);
  if (pooled && PG_SCHEMA !== "public") {
    // PgBouncer does not pass the search_path startup option through to the server.
    throw new Error(
      `DATABASE_URL uses a pooled endpoint (-pooler) with schema "${PG_SCHEMA}". Either use the direct connection string (Neon console, Connect, Connection pooling off), or set DATABASE_SCHEMA=public to use the pooler.`,
    );
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  // Managed Postgres hosts (Neon) present publicly trusted certificates, so verify them.
  const verify = /\.neon\.tech$/.test(url.hostname) || process.env.DATABASE_SSL_VERIFY === "true";
  const channelBinding = url.searchParams.get("channel_binding") === "require";
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");
  const pool = new pg.Pool({
    connectionString: url.toString(),
    // Startup parameter, so no extra query runs on each new connection.
    // "public" is already first in the default search path, so the pooler needs no option.
    options: PG_SCHEMA === "public" ? undefined : `-c search_path=${PG_SCHEMA},public`,
    max: config.databasePoolSize,
    // Serverless instances are short lived: release idle connections quickly.
    idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
    ssl: local ? undefined : { rejectUnauthorized: verify },
    // SCRAM-SHA-256-PLUS: binds authentication to the TLS session when the URL asks for it.
    enableChannelBinding: channelBinding,
    // Neon suspends idle computes; the first connection can take a few seconds to wake it.
    connectionTimeoutMillis: 20_000,
  });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('atgl-migrate'))");
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${PG_SCHEMA}`);
    await client.query(`SET search_path TO ${PG_SCHEMA}, public`);
    await client.query(DDL.replace(/\{SERIAL_PK\}/g, "BIGSERIAL PRIMARY KEY"));
    // Row-level security with no policies: invisible to any hosted data API roles.
    for (const t of TABLES) await client.query(`ALTER TABLE ${PG_SCHEMA}.${t} ENABLE ROW LEVEL SECURITY`);
    await client.query("INSERT INTO meta(key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [String(SCHEMA_VERSION)]);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('atgl-migrate'))").catch(() => undefined);
    client.release();
  }
  return {
    q: pgQueryable(pool),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const out = await fn(pgQueryable(c));
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openSqlite(): Promise<Handle> {
  if (process.env.VERCEL) {
    throw new Error("No DATABASE_URL set. Serverless deployments have no writable disk, so set DATABASE_URL to your Postgres (Neon) connection string.");
  }
  const { DatabaseSync } = await import("node:sqlite");
  const path = resolve(/*turbopackIgnore: true*/ process.cwd(), config.databasePath);
  mkdirSync(/*turbopackIgnore: true*/ dirname(path), { recursive: true });
  const conn = new DatabaseSync(path);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  conn.exec(DDL.replace(/\{SERIAL_PK\}/g, "INTEGER PRIMARY KEY AUTOINCREMENT"));
  conn.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(SCHEMA_VERSION));
  const q = sqliteQueryable(conn);
  // One connection: serialise transactions so awaits inside one cannot interleave another.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    q,
    tx<T>(fn: (t: Queryable) => Promise<T>) {
      const next = chain.then(async () => {
        conn.exec("BEGIN IMMEDIATE");
        try {
          const out = await fn(q);
          conn.exec("COMMIT");
          return out;
        } catch (e) {
          conn.exec("ROLLBACK");
          throw e;
        }
      });
      chain = next.catch(() => undefined);
      return next;
    },
    async close() {
      conn.close();
    },
  };
}

function handle(): Promise<Handle> {
  g.__atglDb ??= (usingPostgres() ? openPostgres() : openSqlite()).catch((e) => {
    g.__atglDb = undefined;
    throw e;
  });
  return g.__atglDb;
}

export async function all<T = Row>(sql: string, ...params: Param[]): Promise<T[]> {
  return (await handle()).q.all<T>(sql, ...params);
}

export async function get<T = Row>(sql: string, ...params: Param[]): Promise<T | undefined> {
  return (await handle()).q.get<T>(sql, ...params);
}

export async function run(sql: string, ...params: Param[]): Promise<number> {
  return (await handle()).q.run(sql, ...params);
}

export async function tx<T>(fn: (t: Queryable) => Promise<T>): Promise<T> {
  return (await handle()).tx(fn);
}

export async function closeDb(): Promise<void> {
  const h = g.__atglDb;
  g.__atglDb = undefined;
  if (h) await (await h).close();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
