// SOP-08 backup and restore test.
//
//   npm run backup                 consistent online backup + restore verification
//   npm run backup -- --keep 14    retention (default 14 copies)
//   npm run backup -- --restore backups/atgl-2026-09-22T10-00-00.db   (app must be stopped)
//
// A backup is taken with VACUUM INTO (consistent while the app is running),
// then opened read-only and checked with integrity_check and row counts. The
// result is appended to backups/manifest.jsonl as RPO/RTO evidence.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
if (/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
  console.log(
    [
      "DATABASE_URL points at PostgreSQL (Neon). This script backs up the local SQLite file only.",
      "For Neon: point-in-time restore is built in (history retention depends on plan; branches give instant restore copies),",
      "and for an off-platform copy run: pg_dump \"$DATABASE_URL\" --schema=atgl --format=custom --file=backups/atgl-$(date +%F).dump",
      "Restore test: pg_restore --clean --if-exists --no-owner --dbname=<staging database URL> backups/<file>.dump",
    ].join("\n"),
  );
  process.exit(0);
}

const dbPath = resolve(process.env.DATABASE_PATH ?? "data/atgl.db");
const dir = resolve(arg("dir", "backups"));
const keep = Number(arg("keep", "14"));
const TABLES = ["users", "audit_log", "alerts", "opportunities", "agent_runs", "dq_issues", "copilot_log"];

function verify(path) {
  const t0 = Date.now();
  const db = new DatabaseSync(path, { readOnly: true });
  const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  const counts = Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
  db.close();
  return { integrity, counts, verifyMs: Date.now() - t0 };
}

const restore = arg("restore");
if (restore) {
  const src = resolve(restore);
  const check = verify(src);
  if (check.integrity !== "ok") throw new Error(`Backup failed integrity check: ${check.integrity}`);
  if (existsSync(dbPath)) copyFileSync(dbPath, `${dbPath}.pre-restore-${Date.now()}`);
  for (const ext of ["-wal", "-shm"]) if (existsSync(dbPath + ext)) rmSync(dbPath + ext);
  copyFileSync(src, dbPath);
  console.log(`Restored ${src} to ${dbPath}. Previous database kept as .pre-restore copy.`);
  appendFileSync(join(dir, "manifest.jsonl"), JSON.stringify({ kind: "restore", at: new Date().toISOString(), source: src, ...check }) + "\n");
  process.exit(0);
}

if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath}`);
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = join(dir, `atgl-${stamp}.db`);
const t0 = Date.now();
const live = new DatabaseSync(dbPath);
live.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
live.close();
const backupMs = Date.now() - t0;
const check = verify(out);
if (check.integrity !== "ok") throw new Error(`Backup verification failed: ${check.integrity}`);

const files = readdirSync(dir).filter((f) => /^atgl-.*\.db$/.test(f)).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) rmSync(join(dir, f));

const entry = { kind: "backup", at: new Date().toISOString(), file: out, bytes: statSync(out).size, backupMs, ...check, retained: Math.min(files.length, keep) };
appendFileSync(join(dir, "manifest.jsonl"), JSON.stringify(entry) + "\n");
console.log(JSON.stringify(entry, null, 2));
