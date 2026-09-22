// Capture a screenshot set of every screen for documentation.
//   DEMO_USER_PASSWORD=... node scripts/screenshots.mjs --base http://localhost:3100 --out ../images
// Uses the locally installed Chrome with a throwaway profile, closed by the script.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const base = arg("base", "http://localhost:3100");
const out = arg("out", "images");
const password = process.env.DEMO_USER_PASSWORD;
if (!password) throw new Error("Set DEMO_USER_PASSWORD");
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(out, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "atgl-shots-"));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile, args: ["--no-first-run", "--hide-scrollbars"] });

async function session(user, { width = 1440, theme = "light" } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  if (user) {
    await page.goto(`${base}/login`, { waitUntil: "networkidle0" });
    await page.type("#username", user);
    await page.type("#password", password);
    await page.click("button[type=submit]");
    await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 60_000 });
  }
  return { page, ctx };
}

async function shot(page, name, path, { full = true, before } = {}) {
  if (path) await page.goto(`${base}${path}`, { waitUntil: "networkidle0", timeout: 120_000 });
  if (before) await before(page);
  await new Promise((r) => setTimeout(r, 400));
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  console.log(`saved ${file}`);
}

const openFirst = (selectorHas) => async (page) => {
  await page.$$eval(
    "details",
    (ds, has) => {
      const d = has ? ds.find((x) => x.querySelector(has)) ?? ds[0] : ds[0];
      if (d) d.open = true;
    },
    selectorHas,
  );
};

try {
  {
    const { page, ctx } = await session(null);
    await shot(page, "01-login", "/login", { full: false });
    await ctx.close();
  }
  {
    const { page, ctx } = await session("leadership");
    await shot(page, "02-overview", "/");
    await shot(page, "03-energy", "/energy");
    await shot(page, "04-gas-and-uag", "/gas");
    await shot(page, "05-metering", "/metering");
    await shot(page, "06-asset-reliability", "/reliability");
    await shot(page, "07-billing-assurance", "/billing");
    await shot(page, "08-vendors-and-amc", "/vendors");
    await shot(page, "09-safety-and-integrity", "/safety");
    await shot(page, "10-opportunity-register", "/opportunities", { before: openFirst("input[name=approve]") });
    await shot(page, "11-alerts", "/alerts", { before: openFirst() });
    await shot(page, "12-executive-copilot", "/copilot", {
      full: false,
      before: async (p) => {
        await p.type("#copilot-input", "Where is UAG highest this week and what is driving it?");
        await p.keyboard.press("Enter");
        await p.waitForFunction(() => /Sources/.test(document.body.innerText), { timeout: 120_000 });
        await p.$$eval("article details", (ds) => ds.forEach((d) => (d.open = true)));
      },
    });
    await shot(page, "13-reports", "/reports");
    await shot(page, "14-report-management-summary", "/reports/print?type=management");
    await shot(page, "15-overview-vadodara-30-days", "/?zone=VAD&window=30d");
    await ctx.close();
  }
  {
    const { page, ctx } = await session("engineering");
    await shot(page, "16-data-quality", "/data-quality");
    await shot(page, "17-ai-agents", "/agents");
    await ctx.close();
  }
  {
    const { page, ctx } = await session("admin");
    await shot(page, "18-admin-users-and-roles", "/admin/users");
    await shot(page, "19-admin-integrations", "/admin/integrations");
    await shot(page, "20-admin-audit-log", "/admin/audit");
    await shot(page, "21-admin-system-health", "/admin/health");
    await shot(page, "22-sops", "/sops");
    await shot(page, "23-access-denied", "/energy", { full: false });
    await ctx.close();
  }
  {
    const { page, ctx } = await session("siteuser", { width: 390 });
    await shot(page, "24-mobile-site-user-overview", "/");
    await ctx.close();
  }
  {
    const { page, ctx } = await session("leadership", { theme: "dark" });
    await shot(page, "25-dark-mode-overview", "/", { full: false });
    await ctx.close();
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
