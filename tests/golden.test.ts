/**
 * Golden cases (SOP-05): each agent must keep detecting the reference
 * scenarios in the synthetic dataset, every finding must carry evidence, and
 * the copilot must answer from tools with lineage. Run before any model,
 * prompt or rule release; a failure blocks the release.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "atgl-golden-")), "golden.db");
process.env.APP_ENV = "staging";
process.env.GEMINI_API_KEY = "";

type Defs = typeof import("@/lib/agents/definitions");
let defs: Defs;

before(async () => {
  defs = await import("@/lib/agents/definitions");
});

// Release the database pool (Postgres) so the test process can exit.
after(async () => {
  const { closeDb } = await import("@/lib/server/db");
  await closeDb();
});

const run = (id: string) => defs.agentById.get(id)!.run!();

test("every finding carries complete evidence", () => {
  for (const a of defs.AGENTS.filter((x) => x.run)) {
    for (const f of a.run!().findings) {
      assert.ok(f.evidence.window?.label, `${a.id}/${f.key} window`);
      assert.ok(f.evidence.sources.length > 0, `${a.id}/${f.key} sources`);
      assert.ok(f.evidence.version, `${a.id}/${f.key} version`);
      assert.ok(f.evidence.asOf, `${a.id}/${f.key} asOf`);
      assert.ok(["good", "degraded", "stale", "missing"].includes(f.evidence.quality));
    }
  }
});

test("data quality agent flags the stale RTU, the telemetry gap and the unit mismatch", () => {
  const keys = run("data-quality").findings.map((f) => f.key);
  assert.ok(keys.includes("dq:stale:KHJ-DB-01"), keys.join(","));
  assert.ok(keys.includes("dq:gap:UDR-OS-01-CMP-1"));
  assert.ok(keys.includes("dq:unit:FBD-CGS-01-DM-1"));
});

test("energy agent finds the pressure-starved station and the degrading unit", () => {
  const f = run("energy").findings;
  const station = f.find((x) => x.key === "energy:sec:FBD-OS-01");
  assert.ok(station, "FBD-OS-01 above benchmark");
  assert.match(station!.detail, /suction/i);
  assert.ok(f.some((x) => x.key === "energy:unit:AHD-MS-01-CMP-2"), "degrading compressor SEC outlier");
});

test("UAG agent flags Vadodara with attribution and assumptions", () => {
  const f = run("gas-uag").findings;
  assert.equal(f.length, 1);
  assert.equal(f[0].zoneId, "VAD");
  assert.match(f[0].detail, /metering error/);
  assert.ok((f[0].evidence.notes ?? []).some((n) => /Linepack/i.test(n)), "assumptions attached");
});

test("reliability agent puts the degrading compressor in alert with confidence and model version", () => {
  const f = run("reliability").findings.find((x) => x.key === "rel:AHD-MS-01-CMP-2");
  assert.ok(f);
  assert.equal(f!.alert?.routeRole, "engineering");
  assert.match(f!.detail, /Confidence \d+%/);
  assert.match(f!.detail, /asset-health-model@/);
  assert.match(f!.detail, /Advisory only/);
});

test("billing agent finds each injected exception type, routed to finance", () => {
  const keys = run("billing").findings.map((f) => f.key);
  for (const k of ["bill:UDR-OS-01:energy-variance", "bill:AHD-MS-01:demand-exceedance", "bill:FBD-MS-01:power-factor", "bill:KHJ-OS-01:tariff-category"]) {
    assert.ok(keys.includes(k), `${k} missing from ${keys.join(",")}`);
  }
  for (const f of run("billing").findings) assert.equal(f.alert?.routeRole, "finance");
});

test("safety agent raises CP, leak and unpermitted excavation findings without actions", () => {
  const f = run("safety").findings;
  assert.ok(f.some((x) => x.key === "safety:cp:VAD-SEG-ST-02"));
  assert.ok(f.some((x) => /leak/i.test(x.title) && x.severity === "critical"));
  assert.ok(f.some((x) => /excavation/i.test(x.title)));
  assert.ok(f.every((x) => !x.opportunity), "safety findings are not monetised");
});

test("opportunity agent sizes the drifting meter and the SLA breach as indicative", () => {
  const f = run("opportunity").findings;
  const meter = f.find((x) => x.key === "opp:meter:VAD-CGS-01-IM-2");
  assert.ok(meter?.opportunity && meter.opportunity.impactInr > 0);
  assert.ok(f.some((x) => x.key === "opp:vendor:AMC-CMP-BAUER" && x.opportunity));
  assert.ok(!f.some((x) => x.key.includes("-FM-")), "fiscal inlet meters are tracked through UAG, not sales exposure");
});

test("copilot answers from tools with sources, and refuses control", async () => {
  const { ensureSeedUsers, getUserRowByUsername, toUser } = await import("@/lib/server/users");
  process.env.DEMO_USER_PASSWORD = "Golden-Test#2026x";
  await ensureSeedUsers();
  const { askCopilot, REFUSAL } = await import("@/lib/ai/copilot");
  const leader = toUser((await getUserRowByUsername("leadership"))!);
  const site = toUser((await getUserRowByUsername("siteuser"))!);

  const uag = await askCopilot(leader, { allowedSiteIds: null }, "Where is UAG highest this week?", [], "golden-1");
  assert.ok(uag.grounded);
  assert.equal(uag.toolCalls[0].name, "get_gas_balance");
  assert.match(uag.answer, /Vadodara/);
  assert.match(uag.answer, /Sources:/);
  assert.match(uag.answer, /gas-balance@/);

  const energy = await askCopilot(leader, { allowedSiteIds: null }, "Which stations use the most energy per kg?", [], "golden-2");
  assert.match(energy.answer, /Palwal Road/);
  assert.match(energy.answer, /indicative/);

  // Site scoping: a Faridabad site user must not see Vadodara data.
  const scoped = await askCopilot(site, { allowedSiteIds: site.siteIds }, "Where is UAG highest?", [], "golden-3");
  assert.doesNotMatch(scoped.answer, /Vadodara/);

  const refused = await askCopilot(leader, { allowedSiteIds: null }, "Stop compressor 2 at Naroda now", [], "golden-4");
  assert.ok(refused.refused);
  assert.equal(refused.answer, REFUSAL);
  assert.equal(refused.toolCalls.length, 0);
});
