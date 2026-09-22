/**
 * Negative-control and governance tests (Section 9: "OT safety: dashboard has
 * no command/write path; read-only controls are verified by negative test").
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isControlRequest } from "@/lib/ai/copilot";
import { TOOL_DECLARATIONS } from "@/lib/ai/tools";
import { can, canView, ROLES } from "@/lib/auth/rbac";
import { connectors, defineConnector, FORBIDDEN_VERBS, readOnlyAudit } from "@/lib/connectors";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("every connector exposes only read methods and is frozen", () => {
  for (const r of readOnlyAudit()) {
    assert.deepEqual(r.violations, [], `${r.connector} exposes write-like methods`);
    assert.ok(r.frozen, `${r.connector} must be frozen`);
    assert.ok(r.methods.every((m) => /^(get|list|query|read|fetch|describe)/.test(m)), `${r.connector} has a non-read method`);
  }
});

test("defineConnector rejects write/command methods", () => {
  const d = { id: "x", system: "SCADA" as const, name: "x", owner: "x", protocol: "x", networkPath: "x", serviceAccount: "x", expectedFreshnessMin: 1, pollInterval: "x" };
  const status = () => ({ state: "healthy" as const, lagMinutes: 0, lastGoodSample: 0, recordsLastRun: 0, credentialRotatedAt: "x" });
  for (const name of ["writeSetpoint", "setValve", "stopCompressor", "commandRtu", "controlPump", "updateTag", "resetTrip"]) {
    assert.throws(() => defineConnector(d, status, { [name]: () => 1 }), /read-only/, `${name} should be rejected`);
  }
});

test("connector objects cannot be mutated at runtime", () => {
  const c = connectors[0] as unknown as { read: Record<string, unknown> };
  assert.throws(() => {
    "use strict";
    c.read.writeTag = () => 1;
  });
});

test("no source file references an OT write verb on a connector", () => {
  const offenders = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && /\.read\.(write|set|put|command|control|stop|start|trip|reset)\w*\(/i.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});

test("copilot tools are read-only lookups", () => {
  for (const t of TOOL_DECLARATIONS) {
    assert.match(t.name, /^(get|list)_/, `tool ${t.name} must be a get/list lookup`);
    assert.ok(!FORBIDDEN_VERBS.test(t.name.replace(/^(get|list)_/, "")), `tool ${t.name} looks like a write`);
  }
});

test("API routes expose no PUT/PATCH/DELETE handlers", () => {
  const routes = walk("src/app/api").filter((f) => f.endsWith("route.ts"));
  for (const f of routes) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/export\s+(async\s+)?function\s+(PUT|PATCH|DELETE)\b/.test(src), `${f} exports a mutating verb`);
  }
});

test("copilot refuses operational control requests", () => {
  for (const q of [
    "Stop compressor 2 at Naroda",
    "Please increase the suction pressure set-point at FBD-OS-01",
    "Can you close the valve on the Vadodara spur?",
    "shut down the dispenser at AHD-OS-02",
    "Could you reset the rectifier breaker",
  ]) {
    assert.ok(isControlRequest(q), `should refuse: ${q}`);
  }
  for (const q of [
    "Why did UAG increase at the Vadodara station?",
    "Which compressors need attention?",
    "What changed in energy use at Naroda station this week?",
    "Show the pressure trend at FBD-OS-01",
    "How many stations have low cascade inventory?",
  ]) {
    assert.ok(!isControlRequest(q), `should answer: ${q}`);
  }
});

test("role matrix enforces Section 5 restrictions", () => {
  // Platform admin: no business approval rights by default.
  assert.ok(!can("platform_admin", "opportunity.validate"));
  assert.ok(!can("platform_admin", "alert.close"));
  assert.ok(can("platform_admin", "user.manage"));
  // Viewer: no write actions at all.
  for (const a of ["alert.acknowledge", "alert.close", "opportunity.edit", "opportunity.validate", "dq.resolve", "agent.run", "report.generate", "user.manage"] as const) {
    assert.ok(!can("viewer", a), `viewer must not ${a}`);
  }
  // Leadership: approvals but no configuration.
  assert.ok(can("leadership", "opportunity.validate"));
  assert.ok(!can("leadership", "user.manage"));
  assert.ok(!canView("leadership", "admin-users"));
  // Security: logs and integrations, no business data editing.
  assert.ok(canView("security", "admin-audit"));
  assert.ok(!can("security", "opportunity.edit"));
  // Only platform admin manages users.
  for (const r of ROLES) assert.equal(can(r, "user.manage"), r === "platform_admin");
  // Finance sees billing; site users do not.
  assert.ok(canView("finance", "billing"));
  assert.ok(!canView("site_user", "billing"));
});
