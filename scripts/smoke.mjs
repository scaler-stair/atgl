// End-to-end smoke test: signs in as a role, visits pages, captures
// console/page errors and screenshots. Uses the locally installed Chrome
// with a throwaway profile; the browser is closed by the script itself.
//
//   node scripts/smoke.mjs --base http://localhost:3000 --user leadership --pages /,/energy --out .smoke
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const base = arg("base", "http://localhost:3000");
const user = arg("user", "leadership");
const password = arg("password", process.env.DEMO_USER_PASSWORD);
const pages = arg("pages", "/").split(",");
const out = arg("out", ".smoke");
const width = Number(arg("width", "1440"));
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!password) throw new Error("Set DEMO_USER_PASSWORD or pass --password");
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "atgl-smoke-"));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile, args: ["--no-first-run", "--no-default-browser-check"] });
let failures = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 1000 });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/login`, { waitUntil: "networkidle0" });
  await page.type("#username", user);
  await page.type("#password", password);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !location.pathname.startsWith("/login") || document.querySelector("[role=alert]"), { timeout: 60_000 });
  if (page.url().includes("/login")) {
    const msg = await page.$eval("[role=alert]", (e) => e.textContent).catch(() => "");
    throw new Error(`Login failed for ${user}: ${msg}`);
  }
  await page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
  for (const p of pages) {
    errors.length = 0;
    const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle0", timeout: 90_000 });
    const status = res?.status();
    const file = join(out, `${user}${p.replace(/[/?=&]/g, "_") || "_root"}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const bad = status >= 400 || errors.length > 0 || page.url().includes("/denied");
    if (bad) failures++;
    console.log(`${bad ? "FAIL" : "ok  "} ${status} ${p} -> ${page.url().replace(base, "")} ${file}${errors.length ? `\n      ${errors.slice(0, 3).join("\n      ")}` : ""}`);
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
