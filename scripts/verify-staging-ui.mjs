/**
 * Runtime UI verification for staging (or local public/) at mobile viewport.
 * Bypasses access gate for layout measurement only — does not claim auth flows.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const viewport = { width: 390, height: 844 };
const BOTTOM_GAP_MAX = 48;

function startStaticServer() {
  const publicDir = path.join(root, "public");
  const server = createServer((req, res) => {
    const urlPath = req.url?.split("?")[0] || "/";
    const filePath = path.join(publicDir, urlPath === "/" ? "index.html" : urlPath.replace(/^\//, ""));
    if (!existsSync(filePath) || !filePath.startsWith(publicDir)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const data = readFileSync(filePath);
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".png": "image/png",
      ".webmanifest": "application/manifest+json"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

async function unlockApp(page) {
  await page.evaluate(() => {
    document.body.classList.remove("access-locked");
    const gate = document.querySelector(".access-gate");
    if (gate) gate.remove();
    const app = document.querySelector(".app");
    if (app) app.style.display = "";
  });
}

async function measurePanel(page, panelSelector, cardSelector) {
  return page.evaluate(({ panelSelector, cardSelector, bottomGapMax }) => {
    const vh = window.innerHeight;
    const panel = document.querySelector(panelSelector);
    const card = document.querySelector(cardSelector);
    const box = (el) => el ? {
      bottom: Math.round(el.getBoundingClientRect().bottom),
      height: Math.round(el.getBoundingClientRect().height),
      display: getComputedStyle(el).display,
      flex: getComputedStyle(el).flex
    } : null;
    const gap = card ? vh - card.getBoundingClientRect().bottom : vh;
    return {
      viewportHeight: vh,
      panel: box(panel),
      card: box(card),
      gapBelowCard: Math.round(gap),
      reachesBottom: gap <= bottomGapMax,
      overflowX: document.documentElement.scrollWidth > window.innerWidth
    };
  }, { panelSelector, cardSelector, bottomGapMax: BOTTOM_GAP_MAX });
}

async function verifyUrl(browser, url, label) {
  const page = await browser.newPage();
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  await unlockApp(page);
  await page.waitForTimeout(300);

  const ops = await measurePanel(page, "#mainPanelOperations", "#workspace");

  // Saved-opportunity feedback must not appear; MISSING_DATA copy must show
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("iaqar:operations-data", {
      detail: {
        authoritative: true,
        items: [
          {
            id: "saved-test",
            recordId: "opp_test",
            recordType: "opportunity",
            operationType: "OPPORTUNITY_SAVED",
            title: "فرصة جديدة محفوظة",
            subtitle: "test",
            priority: 0,
            time: "الآن",
            detailsLines: ["test"],
            actionLabel: "فتح",
            opportunityId: "opp_test"
          },
          {
            id: "op_missing",
            recordId: "op_missing",
            recordType: "operation",
            operationType: "MISSING_DATA",
            title: "استكمال بيانات الفرصة",
            subtitle: "يرجى استكمال البيانات لتفعيل المطابقة.",
            actionLabel: "استكمال البيانات",
            priority: 1,
            time: "الآن",
            detailsLines: ["يرجى استكمال البيانات لتفعيل المطابقة."],
            icon: "i-clipboard-list",
            opportunityId: "opp_missing"
          }
        ]
      }
    }));
  });
  await page.waitForTimeout(250);
  await page.click(".operation");
  await page.waitForTimeout(150);
  const opsPresentation = await page.evaluate(() => {
    const text = document.body.innerText;
    const h3 = document.querySelector(".operation h3");
    const p = document.querySelector(".operation p");
    return {
      savedVisible: text.includes("فرصة جديدة محفوظة"),
      operationCount: document.querySelectorAll(".operation").length,
      title: h3?.textContent?.trim() || "",
      subtitle: p?.textContent?.trim() || "",
      action: document.querySelector(".details .start")?.textContent?.trim() || ""
    };
  });

  await page.click("#mainTabOpportunities");
  await page.waitForTimeout(300);
  const oppsAdd = await measurePanel(page, "#oppPanelAdd", "#addOpportunity");

  await page.click("#oppTabBank");
  await page.waitForTimeout(300);
  const bank = await measurePanel(page, "#oppPanelBank", "#opportunityBank");
  const bankLabels = await page.evaluate(() => {
    const filters = document.querySelector(".bank-filters");
    const html = filters?.innerHTML || "";
    return {
      bankSearch: html.includes("ابحث في العروض والطلبات"),
      bankFilters: Boolean(filters),
      oldBulkShare: Boolean(document.querySelector(".bank-share-scope")),
      clearFilters: html.includes("مسح الفلاتر")
    };
  });

  await page.click("#officeSettingsBtn");
  await page.waitForTimeout(500);
  const settings = await page.evaluate(() => {
    const overlay = document.querySelector("#officeSettingsOverlay");
    const text = overlay?.innerText || "";
    return {
      bankInSettings: text.includes("العروض والطلبات"),
      wideCover: /ترويسة عريضة|صورة الترويسة|share-header/i.test(text)
    };
  });

  await page.close();
  return {
    label,
    url,
    viewport,
    operations: ops,
    opportunitiesAdd: oppsAdd,
    bank: { ...bank, labels: bankLabels },
    savedHidden: opsPresentation,
    missingUi: {
      title: opsPresentation.title,
      subtitle: opsPresentation.subtitle,
      action: opsPresentation.action
    },
    settings
  };
}

const stagingDefault = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const target = process.argv[2] || stagingDefault;

const browser = await chromium.launch({ headless: true });
const results = [];

if (target === "local") {
  const { server, url } = await startStaticServer();
  results.push(await verifyUrl(browser, url, "local"));
  server.close();
} else {
  results.push(await verifyUrl(browser, target.replace(/\/$/, ""), "staging"));
}

await browser.close();

const r = results[0];
const pass = {
  operationsReachBottom: r.operations.reachesBottom,
  oppsReachBottom: r.opportunitiesAdd.reachesBottom,
  bankReachBottom: r.bank.reachesBottom,
  savedHidden: !r.savedHidden.savedVisible && r.savedHidden.operationCount === 1,
  missingTitle: r.missingUi.title === "استكمال بيانات الفرصة",
  missingSubtitle: r.missingUi.subtitle === "يرجى استكمال البيانات لتفعيل المطابقة.",
  missingAction: r.missingUi.action === "استكمال البيانات",
  shareLabels: r.bank.labels.bankSearch && r.bank.labels.bankFilters && !r.bank.labels.oldBulkShare,
  settingsOk: !r.settings.bankInSettings && !r.settings.wideCover,
  noOverflow: !r.operations.overflowX && !r.bank.overflowX
};

console.log(JSON.stringify({ results: r, pass }, null, 2));

const failed = Object.entries(pass).filter(([, ok]) => !ok).map(([k]) => k);
if (failed.length) {
  console.error("FAILED checks:", failed.join(", "));
  process.exit(1);
}
