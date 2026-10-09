// «مدير المكتب الذكي» — browser check on the local harness (real Worker, in-memory store, seeded deals):
// the home card's numbers equal the Daily Tasks lanes, «تحتاج تدخلك» opens the filtered list, the
// broker talks to the office manager, and the manager switches it on. No message leaves the machine.
//   node scripts/qa/office-os/agent.e2e.mjs   (OUT_DIR for screenshots)
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/agent");
fs.mkdirSync(OUT, { recursive: true });

const { startOfficeOsHarness, OWNER_A, OFFICE_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { seedStates } = await import(path.join(ROOT, "scripts/qa/office-os/seed.mjs"));
const h = await startOfficeOsHarness();
await seedStates(h);

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = [];
const errors = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
let step = "start";
const shot = async (page, name) => {
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check(`no horizontal scroll: ${name}`, overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true });
await ctx.addInitScript(([u, o]) => { localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o); }, [OWNER_A, OFFICE_A]);
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
try {
  step = "home";
  await page.goto(`${h.origin}/#/office`);
  await page.locator("[data-agent-card]").waitFor();
  await page.waitForFunction(() => document.querySelector("[data-agent-needs]")?.dataset.count !== undefined && document.querySelector("[data-agent-status]")?.dataset.state);
  const home = await page.evaluate(() => ({
    needs: Number(document.querySelector("[data-agent-needs]").dataset.count),
    following: Number(document.querySelector("[data-agent-facts]").dataset.following),
    status: document.querySelector("[data-agent-status]").dataset.state,
    order: [...document.querySelectorAll(".ref-office-section")].map((s) => s.querySelector("h2, b")?.textContent.trim())
  }));
  check("the card sits inside «أدوات المكتب», before the six tools", home.order[0] === "أدوات المكتب" && (await page.locator(".ref-office-section").first().locator("[data-agent-card] + .ref-office-tools").count()) === 1, home.order.join(" › "));
  check("the agent is shown as off before the manager switches it on (never «يعمل» by default)", home.status === "OFF", home.status);
  check("there are seeded decisions waiting", home.needs > 0, String(home.needs));
  await shot(page, "01-home-card");

  step = "tasks";
  await page.goto(`${h.origin}/#/tasks`);
  await page.locator('.ref-lane-head[data-lane="NEEDS_YOU"]').waitFor();
  const lanes = await page.evaluate(() => ({
    needs: document.querySelectorAll('.os-task-list > [data-lane="NEEDS_YOU"]:not(.ref-lane-head)').length,
    following: document.querySelectorAll('.os-task-list > [data-lane="FOLLOWING"]:not(.ref-lane-head)').length,
    firstLane: document.querySelector(".ref-lane-head")?.dataset.lane,
    reasons: document.querySelectorAll('[data-lane="NEEDS_YOU"] [data-lane-reason]').length,
    ids: [...document.querySelectorAll(".os-task-list > [data-lane]:not(.ref-lane-head)")].map((el) => el.dataset.deal || el.dataset.task || el.dataset.id || "")
  }));
  check("«تحتاج تدخلك» comes first", lanes.firstLane === "NEEDS_YOU", lanes.firstLane);
  check("home «تحتاج تدخلك» = the cards in that lane", lanes.needs === home.needs, `${home.needs} vs ${lanes.needs}`);
  check("home «بانتظار رد/يتابعها» = the cards in that lane", lanes.following === home.following, `${home.following} vs ${lanes.following}`);
  check("every card that needs the broker says why", lanes.reasons === lanes.needs, `${lanes.reasons}/${lanes.needs}`);
  check("no card is listed twice across lanes", new Set(lanes.ids.filter(Boolean)).size === lanes.ids.filter(Boolean).length);
  await shot(page, "02-tasks-lanes");

  step = "lane-filter";
  await page.goto(`${h.origin}/#/office`);
  await page.locator("[data-agent-needs][data-count]").click();
  await page.waitForFunction(() => location.hash.includes("lane=NEEDS_YOU"));
  await page.locator(".os-task-list > [data-lane]:not(.ref-lane-head)").first().waitFor();
  const filtered = await page.evaluate(() => [...document.querySelectorAll(".os-task-list > [data-lane]:not(.ref-lane-head)")].map((el) => el.dataset.lane));
  check("the home card opens Daily Tasks filtered on «تحتاج تدخلك»", filtered.length === home.needs && filtered.every((l) => l === "NEEDS_YOU"), filtered.join(","));
  await shot(page, "03-tasks-needs-you");

  step = "settings";
  await page.goto(`${h.origin}/#/settings/agent`);
  await page.locator("[data-agent-toggle]").waitFor();
  await page.locator('[data-agent-toggle="on"]').click();
  await page.locator('[data-agent-toggle="off"]').waitFor();
  const state = await page.locator("[data-agent-settings-state]").getAttribute("data-agent-settings-state");
  check("switched on: without a model key it says it works by rules, not «يعمل»", state === "SETUP", state);
  await shot(page, "04-settings");

  step = "chat";
  await page.goto(`${h.origin}/#/agent`);
  await page.locator("[data-agent-suggest]").first().click();
  await page.locator('[data-agent-turn="agent"]').last().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-agent-turn="agent"]').length >= 1 && document.querySelectorAll("[data-agent-item]").length > 0);
  const chat = await page.evaluate(() => ({ items: document.querySelectorAll("[data-agent-item]").length, text: [...document.querySelectorAll('[data-agent-turn="agent"] p')].pop()?.textContent || "" }));
  check("the office manager answers from the office's data with cards to open", chat.items > 0 && /تدخلك/.test(chat.text), chat.text);
  await page.locator("[data-agent-input]").fill("اقبل السعر عن المالك");
  await page.locator("[data-agent-send]").click();
  await page.waitForFunction(() => /قرار ملزم/.test([...document.querySelectorAll('[data-agent-turn="agent"] p')].pop()?.textContent || ""));
  check("a binding decision is refused in the chat", true);
  await shot(page, "05-chat");

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`${h.origin}/#/office`);
  await page.locator("[data-agent-card]").waitFor();
  await shot(page, "06-home-320");
  check("no browser console errors", errors.length === 0, errors.slice(0, 4).join(" | "));
} catch (error) {
  check(`completed without exception (step ${step})`, false, String(error.message).split("\n")[0]);
  try { await page.screenshot({ path: path.join(OUT, "zz-failure.png"), fullPage: true }); } catch (_) { /* ignore */ }
} finally {
  await browser.close();
  h.server.close();
}
const failed = checks.filter((c) => !c.ok);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
if (process.env.GITHUB_ACTIONS) for (const c of failed) console.log(`::error title=agent::${`${c.name} — ${c.detail}`.replace(/\r?\n/g, " ").slice(0, 400)}`);
console.log(`\n${checks.length - failed.length}/${checks.length} agent checks passed`);
process.exit(failed.length ? 1 : 0);
