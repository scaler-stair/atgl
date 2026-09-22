// UAT flow checks (Section 9) against a running instance, in a real browser.
//   DEMO_USER_PASSWORD=... node scripts/uat.mjs --base http://localhost:3100
// Uses the locally installed Chrome with a throwaway profile, closed by the script.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const i = process.argv.indexOf("--base");
const base = i > -1 ? process.argv[i + 1] : "http://localhost:3100";
const password = process.env.DEMO_USER_PASSWORD;
if (!password) throw new Error("Set DEMO_USER_PASSWORD");
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const results = [];
const check = (area, name, ok, detail = "") => {
  results.push({ area, name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  [${area}] ${name}${detail ? `  (${detail})` : ""}`);
};

const profile = mkdtempSync(join(tmpdir(), "atgl-uat-"));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile, args: ["--no-first-run"] });

async function session(user) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(`${base}/login`, { waitUntil: "networkidle0" });
  await page.type("#username", user);
  await page.type("#password", password);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !location.pathname.startsWith("/login") || document.querySelector("[role=alert]"), { timeout: 60_000 });
  return { page, ctx };
}

const go = (page, path) => page.goto(`${base}${path}`, { waitUntil: "networkidle0", timeout: 90_000 });
const text = (page) => page.evaluate(() => document.body.innerText);
const waitText = (page, re, timeout = 30_000) =>
  page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), { timeout }, re.source).then(() => true, () => false);

try {
  // IAM: bad password is rejected without revealing which field was wrong.
  {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await go(page, "/login");
    await page.type("#username", "leadership");
    await page.type("#password", "wrong-password");
    await page.click("button[type=submit]");
    check("IAM", "wrong password rejected with generic message", await waitText(page, /Username or password is incorrect/));
    await ctx.close();
  }

  // Alerts: operations acknowledges then closes an alert with evidence.
  {
    const { page, ctx } = await session("operations");
    check("IAM", "named user signs in", !page.url().includes("/login"));
    await go(page, "/alerts?queue=mine");
    const opened = await page.$$eval("details summary", (els) => {
      if (!els[0]) return false;
      els[0].click();
      return true;
    });
    check("Alerts", "operations has alerts routed to their role", opened);
    if (opened) {
      const ack = await page.$("details[open] form button");
      await ack?.click();
      check("Alerts", "acknowledgement recorded", await waitText(page, /Alert acknowledged\./));
      await page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
      await go(page, "/alerts?status=acknowledged");
      await page.$$eval("details summary", (els) => els[0]?.click());
      await page.type("details[open] input[name=action]", "Dispatched zonal team; meter isolated for proving run");
      await page.type("details[open] input[name=evidence]", "WO-UAT-001, inspection note ref UAT-17");
      const buttons = await page.$$("details[open] form button");
      await buttons[buttons.length - 1].click();
      check("Alerts", "closure with action and evidence recorded", await waitText(page, /Alert closed\./));
    }
    // Site scoping: Faridabad-only data must not be visible to an Ahmedabad/Vadodara user.
    await go(page, "/energy?site=FBD-OS-01");
    check("IAM", "site scope blocks sites outside assignment", !(await text(page)).includes("Palwal Road CNG Online Station:"));
    await ctx.close();
  }

  // Opportunities: leadership validates and approves; values become validated.
  {
    const { page, ctx } = await session("leadership");
    await go(page, "/opportunities");
    const found = await page.$$eval("details", (ds) => {
      const d = ds.find((x) => x.querySelector("input[name=approve]"));
      if (d) d.open = true;
      return !!d;
    });
    check("Opportunity", "an indicative opportunity awaits validation", found);
    await page.click("details[open] input[name=approve]");
    const btns = await page.$$("details[open] form button");
    await btns[btns.length - 1].click();
    check("Opportunity", "leadership validates and approves", await waitText(page, /Value validated and approved\./));
    await go(page, "/admin/users");
    check("IAM", "leadership cannot open user admin", page.url().includes("/denied"));

    // Copilot: grounded answer with sources; control request refused.
    await go(page, "/copilot");
    await page.type("#copilot-input", "Where is UAG highest this week and why?");
    await page.keyboard.press("Enter");
    check("AI copilot", "answer is grounded with sources", await waitText(page, /Sources/, 120_000));
    check("AI copilot", "answer shows grounding tag", /Grounded in platform data/.test(await text(page)));
    await page.waitForFunction(() => !/Looking up the data/.test(document.body.innerText), { timeout: 120_000 }).catch(() => {});
    await page.type("#copilot-input", "Please stop compressor 2 at Naroda");
    await page.keyboard.press("Enter");
    check("OT safety", "copilot refuses operational control", await waitText(page, /read-only by design/, 60_000));
    await ctx.close();
  }

  // Viewer: read-only.
  {
    const { page, ctx } = await session("viewer");
    await go(page, "/opportunities");
    const writeControls = await page.$$("main form select, main form input[name=value], main form input[name=note]");
    check("IAM", "viewer sees register without write controls", writeControls.length === 0, `${writeControls.length} controls`);
    await go(page, "/copilot");
    check("IAM", "viewer has no copilot", page.url().includes("/denied"));
    await ctx.close();
  }

  // Site user: billing is out of role.
  {
    const { page, ctx } = await session("siteuser");
    await go(page, "/billing");
    check("IAM", "site user cannot open billing", page.url().includes("/denied"));
    await go(page, "/");
    const t = await text(page);
    check("IAM", "site user overview limited to assigned sites", !/Vadodara UAG/.test(t));
    await ctx.close();
  }

  // Security / negative controls over HTTP.
  {
    const r1 = await fetch(`${base}/api/copilot`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    check("Security", "copilot API requires a session", r1.status === 401, `status ${r1.status}`);
    const r2 = await fetch(`${base}/api/agents/run`, { method: "POST", headers: { authorization: "Bearer not-the-token" } });
    check("Security", "scheduler endpoint rejects bad token", r2.status === 401, `status ${r2.status}`);
    const r3 = await fetch(`${base}/api/copilot`, { method: "PUT" });
    check("OT safety", "no PUT handler on API", r3.status === 401 || r3.status === 405, `status ${r3.status}`);
    const r4 = await fetch(`${base}/api/health`);
    check("Security / ops", "health endpoint responds", r4.ok, `status ${r4.status}`);
    const r5 = await fetch(`${base}/`, { redirect: "manual" });
    check("Security", "security headers present", r5.headers.get("x-frame-options") === "DENY" && !!r5.headers.get("x-correlation-id"));
  }

  // Audit: privileged actions above appear in the audit log.
  {
    const { page, ctx } = await session("security");
    await go(page, "/admin/audit");
    const t = await text(page);
    check("Audit", "alert closure logged", /alert\.close/.test(t));
    check("Audit", "opportunity validation logged", /opportunity\.validate/.test(t));
    check("Audit", "denied access logged or login failures logged", /denied|failure/i.test(t));
    await ctx.close();
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
