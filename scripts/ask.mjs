// Ask the copilot one question as a user, print the answer and lineage.
//   DEMO_USER_PASSWORD=... node scripts/ask.mjs --user leadership "Where is UAG highest?"
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const base = arg("base", "http://localhost:3100");
const user = arg("user", "leadership");
const question = process.argv[process.argv.length - 1];
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "atgl-ask-"));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile });
try {
  const page = await browser.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle0" });
  await page.type("#username", user);
  await page.type("#password", process.env.DEMO_USER_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 60_000 });
  const res = await page.evaluate(async (q) => {
    const r = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, history: [] }) });
    return { status: r.status, body: await r.json() };
  }, question);
  const b = res.body;
  console.log(`status ${res.status}, model ${b.model}, grounded ${b.grounded}, refused ${b.refused}, ${b.latencyMs} ms`);
  console.log(`tools: ${(b.toolCalls ?? []).map((t) => `${t.name}(${JSON.stringify(t.args)})`).join(", ")}`);
  console.log("---\n" + (b.answer ?? b.error));
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
