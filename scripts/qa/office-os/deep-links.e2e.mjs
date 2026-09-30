// Office OS — old links and deep links after the old shell moved to legacy.html.
//   node scripts/qa/office-os/deep-links.e2e.mjs
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, OFFICE_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { seedStates } = await import(path.join(ROOT, "scripts/qa/office-os/seed.mjs"));
const h = await startOfficeOsHarness();
const s = await seedStates(h);
const journeyTask = h.store.list(`offices/${OFFICE_A}/operations`).find((op) => op.journeyId === s.negotiation.journeyId && ["OPEN", "WAITING_EXTERNAL_RESPONSE"].includes(op.status));

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function open(url, { auth = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-SA" });
  if (auth) await ctx.addInitScript(([u, o]) => { localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o); }, [OWNER_A, OFFICE_A]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${h.origin}${url}`);
  return { page, ctx };
}

const LEGACY = [
  "/?cv2Party=PARTYTOKEN123",
  "/?adminApplications=1&openBrokerApplication=app1",
  `/?officeId=${OFFICE_A}&openCooperation=coop_1`,
  `/?officeId=${OFFICE_A}&openDeal=deal_1`,
  `/?officeId=${OFFICE_A}&shared=1`,
  "/?office=platform",
  "/add?kind=owner"
];
for (const url of LEGACY) {
  const { page, ctx } = await open(url);
  await page.waitForURL(/\/legacy\.html/).catch(() => {});
  const got = new URL(page.url());
  const want = new URL(url, "http://x");
  const queryKept = [...want.searchParams].every(([k, v]) => got.searchParams.get(k) === v);
  const status = await page.evaluate(async () => (await fetch(location.href)).status);
  check(`legacy link → legacy.html with its query: ${url}`, got.pathname === "/legacy.html" && queryKept && status === 200, got.pathname + got.search);
  await ctx.close();
}

const NEW = [
  { name: "push link ?openOperation (match review) → review page", url: `/?officeId=${OFFICE_A}&openOperation=${s.reviewTaskId}`, expect: `#/review/${s.review.matchId}`, wait: "text=أسباب التوافق" },
  { name: "push link ?openOperation (journey task) → opportunity workspace", url: `/?officeId=${OFFICE_A}&openOperation=${journeyTask?.id}`, expect: `#/journey/${s.negotiation.journeyId}`, wait: "text=متابعة الفرصة" },
  { name: "?openOpportunity → record page", url: `/?officeId=${OFFICE_A}&openOpportunity=${s.review.offerId}`, expect: `#/record/${s.review.offerId}`, wait: "text=تفاصيل السجل" },
  { name: "?openMatch → review page", url: `/?officeId=${OFFICE_A}&openMatch=${s.review.matchId}`, expect: `#/review/${s.review.matchId}`, wait: "text=أسباب التوافق" },
  { name: "PWA shortcut ?open=add-opportunity → add form", url: "/?source=pwa&open=add-opportunity", expect: "#/record/new", wait: 'input[name="district"]' },
  { name: "PWA shortcut ?open=operations → daily tasks", url: "/?source=pwa&open=operations", expect: "#/tasks", wait: ".ref-path" }
];
for (const t of NEW) {
  const { page, ctx } = await open(t.url, { auth: true });
  let ok = false;
  try { await page.locator(t.wait).first().waitFor(); ok = page.url().includes(t.expect) && new URL(page.url()).pathname === "/"; } catch (_) { /* fail below */ }
  check(t.name, ok, page.url().replace(h.origin, ""));
  await ctx.close();
}

for (const [name, url] of [["/o/<slug> public office page", "/o/sultan"], ["?office=<id>&view=public public office page", `/?office=${OFFICE_A}&view=public`]]) {
  const { page, ctx } = await open(url);
  let ok = false;
  try { await page.getByText("لدي عقار").first().waitFor(); ok = !page.url().includes("legacy"); } catch (_) { /* fail */ }
  check(name, ok);
  await ctx.close();
}
{
  const { page, ctx } = await open("/o/unknown-slug");
  await page.getByText("رابط المكتب غير متاح").waitFor().catch(() => {});
  check("unknown office slug shows a clear message", await page.getByText("رابط المكتب غير متاح").count() > 0);
  await ctx.close();
}
{
  const { page, ctx } = await open(`/?officeId=${OFFICE_A}`);
  await page.locator('input[name="phone"]').waitFor().catch(() => {});
  check("signed-out office link asks for «دخول المكتب»", await page.getByRole("heading", { name: "دخول المكتب" }).count() > 0);
  await ctx.close();
}
for (const [name, url, text] of [
  ["reply link without token → invalid message", "/r", "هذا الرابط غير صالح"],
  ["malformed reply token → invalid message", "/r#abc", "هذا الرابط غير صالح"],
  ["well-formed unknown token → invalid message", `/r#${"Z".repeat(43)}`, "هذا الرابط غير صالح"]
]) {
  const { page, ctx } = await open(url);
  await page.getByText(text).first().waitFor().catch(() => {});
  check(name, await page.getByText(text).count() > 0);
  await ctx.close();
}
for (const file of ["/legacy.html", "/complete.html", "/share-target.html", "/firebase-messaging-sw.js", "/manifest.webmanifest", "/admin/index.html"]) {
  const res = await fetch(`${h.origin}${file}`);
  check(`still served: ${file}`, res.status === 200, String(res.status));
}
const sw = fs.readFileSync(path.join(ROOT, "public/firebase-messaging-sw.js"), "utf8");
check("service worker still precaches the app root", sw.includes('"/"'));

await browser.close();
h.server.close();
fs.writeFileSync(path.join(OUT, "deep-links-report.json"), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
const failed = checks.filter((c) => !c.ok);
if (process.env.GITHUB_ACTIONS) for (const c of failed) console.log(`::error title=deep-links::${JSON.stringify(c).replace(/[\r\n]/g, " ").slice(0, 600)}`);
console.log(`\n${checks.length - failed.length}/${checks.length} link checks passed`);
process.exitCode = failed.length ? 1 : 0;
