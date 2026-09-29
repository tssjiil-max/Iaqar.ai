// Screenshots of the real app (public/) at mobile width for UI review.
// Usage: PLAYWRIGHT_MODULE=<path to playwright/index.mjs> OUT=./shots WIDTH=390 node scripts/qa/ui-journey-preview/shoot.mjs
// Every non-local host is blocked; Worker URLs are answered by the local Worker copy
// on an in-memory Firestore double, so nothing reaches Staging or Production.
import path from "node:path";
import fs from "node:fs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { startPreview } = await import("./server.mjs");

const OUT = process.env.OUT || path.join(process.cwd(), "ui-journey-shots");
const WIDTH = Number(process.env.WIDTH || 390);
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });
const p = await startPreview();
const base = `http://127.0.0.1:${p.port}`;
const browser = await chromium.launch();
const blocked = new Set();
const handoffs = [];
const report = [];

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", serviceWorkers: "block" });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname.endsWith(".iaqar-ai.workers.dev")) {
      // Worker URLs are answered by the local Worker copy; nothing reaches Staging or Production.
      const r = route.request();
      return fetch(`${base}/worker${u.pathname}${u.search}`, { method: r.method(), headers: r.headers(), body: r.postDataBuffer() || undefined })
        .then(async (res) => route.fulfill({ status: res.status, headers: { "content-type": res.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" }, body: Buffer.from(await res.arrayBuffer()) }))
        .catch(() => route.abort());
    }
    if (/wa\.me|whatsapp/.test(u.hostname)) handoffs.push(u.href);
    blocked.add(u.hostname);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => report.push(`pageerror ${e.message.slice(0, 160)}`));
  return { ctx, page };
}
async function audit(page, name) {
  // Overlap/overflow audit of visible interactive and text elements.
  const res = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = { hscroll: document.documentElement.scrollWidth > vw + 1, overflow: [], overlaps: [] };
    const closedDetails = (el) => { const d = el.closest("details:not([open])"); return d && !el.closest("summary"); };
    const els = [...document.querySelectorAll("button, a, input, select, textarea, h1, h2, h3, h4, label, p, strong, span")]
      .filter((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[hidden]") && !closedDetails(el) && !(el.type === "hidden"); });
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) out.overflow.push(`${el.tagName}.${el.className}`.slice(0, 80) + ` "${(el.textContent || "").trim().slice(0, 30)}"`);
    }
    const btns = els.filter((el) => el.matches("button, a, input, select, textarea"));
    for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
      const a = btns[i].getBoundingClientRect(), b = btns[j].getBoundingClientRect();
      if (btns[i].contains(btns[j]) || btns[j].contains(btns[i])) continue;
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 2 && iy > 2) out.overlaps.push(`${(btns[i].textContent || btns[i].name || "").trim().slice(0, 20)} × ${(btns[j].textContent || btns[j].name || "").trim().slice(0, 20)}`);
    }
    out.overflow = out.overflow.slice(0, 8); out.overlaps = out.overlaps.slice(0, 8);
    return out;
  });
  report.push(`${name}: hscroll=${res.hscroll} overflow=${res.overflow.length}${res.overflow.length ? " " + JSON.stringify(res.overflow) : ""} overlaps=${res.overlaps.length}${res.overlaps.length ? " " + JSON.stringify(res.overlaps) : ""}`);
}
async function shot(page, name, { full = true } = {}) {
  await page.waitForTimeout(600);
  await audit(page, name);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
}
const want = (n) => !ONLY.length || ONLY.includes(n);

try {
  if (want("home")) {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/?signedOut=1&env=staging`);
    await page.waitForSelector("#accessGate .access-card");
    await shot(page, "01-home");
    await ctx.close();
  }
  if (want("office")) {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/?office=${p.OFFICE}&view=public&signedOut=1&env=staging`);
    await page.waitForSelector("#publicOfficeProfile h2, #publicOfficeProfile *", { timeout: 8000 }).catch(() => {});
    await shot(page, "02-office-link");
    await page.click("[data-go=owner]");
    await page.waitForSelector("#intakeForm");
    await shot(page, "03-offer-form");
    await page.click(".access-back");
    await page.click("[data-go=client]");
    await page.waitForSelector("#intakeForm");
    await shot(page, "04-request-form");
    await ctx.close();
  }
  if (want("login")) {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/?office=${p.OFFICE}&signedOut=1&env=staging`);
    await page.waitForSelector("#loginForm", { timeout: 8000 });
    await shot(page, "05-office-login");
    await ctx.close();
  }
  if (want("dash")) {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/?office=${p.OFFICE}&env=staging`);
    await page.waitForFunction(() => !document.body.classList.contains("access-locked"), null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    await shot(page, "06-office-dashboard");
    await page.click("#mainTabOpportunities").catch(() => {});
    await page.waitForTimeout(2500);
    await shot(page, "07-offers-requests");
    const action = page.locator("[data-opportunity-primary-action]").first();
    {
      // Same feed shape as the match-negotiation E2E harness: operations plus the
      // canonical opportunity records the workspace hydrates from.
      await page.evaluate(async (office) => {
        const ops = await import("/js/operations-domain.js");
        const list = async (name) => (await fetch(`/store/list?path=${encodeURIComponent(`offices/${office}/${name}`)}`)).json();
        const load = async () => {
          const [opRows, rows] = await Promise.all([list("operations"), list("opportunities")]);
          const operations = opRows.filter((op) => ops.ACTIVE_OPERATION_STATUSES.includes(String(op.status || "").toUpperCase()))
            .map((op) => ops.projectOperationToUiItem({ ...op }, { relativeTime: () => "" }));
          return [...operations, ...rows.map((o) => ({ ...o, recordId: o.id, opportunityId: o.id, recordType: "opportunity", main: "opportunities" }))];
        };
        let latest = await load();
        const emit = () => window.dispatchEvent(new CustomEvent("iaqar:operations-data", { detail: { items: latest, authoritative: true, preview: true } }));
        window.addEventListener("iaqar:operations-data", (event) => { if (!event.detail?.preview) emit(); });
        window.__previewFeed = async () => { latest = await load(); emit(); };
        setInterval(() => { void window.__previewFeed(); }, 1000);
      }, p.OFFICE);
      await page.evaluate(async (id) => { window.IAQAR?.openMatchWorkspace?.(id); await window.__previewFeed(); }, p.match?.id);
      await page.waitForSelector(".cv2-match-workspace", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
      if (await page.locator(".cv2-match-workspace [data-broker-panel]").count()) {
        // Record a few real actions through the local Worker so the actions log renders.
        const ws = (sel) => `.cv2-match-workspace ${sel}`;
        await page.click(ws('[data-party-choices="client"] [data-party-choice="interested"]')).catch(() => {});
        await page.waitForTimeout(1500);
        await page.click(ws('[data-broker-audience-pick="both"]')).catch(() => {});
        await page.fill(ws("[data-broker-message]"), "رسالة معاينة محلية للطرفين").catch(() => {});
        await page.click(ws('[data-broker-action="send_message"]')).catch(() => {});
        await page.waitForTimeout(1500);
        await page.fill(ws("[data-broker-internal-note]"), "ملاحظة داخلية للمعاينة").catch(() => {});
        await page.click(ws('[data-broker-action="save_internal_note"]')).catch(() => {});
        await page.waitForTimeout(2000);
        await page.evaluate(async () => { await window.__previewFeed?.(); });
        await page.waitForTimeout(1200);
      }
      if (await page.locator(".cv2-match-workspace").count()) {
        await page.evaluate(() => { const el = document.querySelector(".cv2-match-workspace"); if (el) { el.style.position = "static"; el.style.overflow = "visible"; } document.querySelector(".app")?.setAttribute("style", "display:none"); document.body.style.overflow = "visible"; });
        await shot(page, "08-match-negotiation");
        await page.evaluate(() => { document.querySelector(".app")?.removeAttribute("style"); const el = document.querySelector(".cv2-match-workspace"); if (el) el.removeAttribute("style"); });
        await page.click('.cv2-match-workspace [data-party-send="client"]').catch(() => {});
        await page.waitForTimeout(2500);
      } else report.push("match workspace not opened");
    }
    await ctx.close();
    const partyUrl = handoffs.map((h) => decodeURIComponent(h)).join(" ").match(/https?:\/\/[^\s]*cv2Party=[A-Za-z0-9._~-]+/);
    if (partyUrl) {
      const token = new URL(partyUrl[0]).searchParams.get("cv2Party");
      const party = await newPage();
      await party.page.goto(`${base}/?cv2Party=${encodeURIComponent(token)}&env=staging`);
      await party.page.waitForTimeout(4000);
      await shot(party.page, "10-party-link");
      await party.ctx.close();
    } else report.push(`no party link captured (${handoffs.length} handoffs)`);
  }
  if (want("deal")) {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/?office=${p.OFFICE}&env=staging`);
    await page.waitForFunction(() => !document.body.classList.contains("access-locked"), null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.evaluate((deal) => window.dispatchEvent(new CustomEvent("iaqar:workflow-action", { detail: { actionMode: "secondary", ...deal } })), p.deal);
    await page.waitForSelector("#iaqarWorkflowOverlay:not([hidden]) .iaqar-workflow-step", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.evaluate(() => { const o = document.getElementById("iaqarWorkflowOverlay"); if (o) { o.style.position = "static"; const pnl = o.querySelector(".iaqar-workflow-panel"); if (pnl) pnl.style.maxHeight = "none"; document.querySelector(".app")?.setAttribute("style", "display:none"); } });
    await shot(page, "09-deal-follow-up");
    await ctx.close();
  }
} finally {
  fs.writeFileSync(path.join(OUT, "report.txt"), [...report, `blocked hosts: ${[...blocked].join(", ")}`, `worker calls: ${JSON.stringify(p.server.workerCalls.slice(0, 20))}`, `client writes: ${JSON.stringify(p.server.clientWrites.slice(0, 20))}`].join("\n"));
  await browser.close();
  p.server.close();
}
console.log(fs.readFileSync(path.join(OUT, "report.txt"), "utf8"));
