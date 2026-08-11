// ACCEPTANCE TESTS 1, 2, 14 and 15 (shell half), asserted against the real
// public/index.html document loaded in jsdom.
//
//   Test 1  — clicking the office logo or the office cover opens Office Settings, and no
//             separate visible Settings button exists.
//   Test 2  — the approved home page has no bottom navigation bar.
//   Test 14 — there is no separate Deals page and no deals navigation item.
//   Test 15 — the shell ships no fabricated demo operations.

import test from "node:test";
import assert from "node:assert/strict";
import { firebaseStub, loadShell, readRepositoryFile } from "./helpers/shell.mjs";

const shellSource = readRepositoryFile("public", "index.html");

async function shell() {
  return loadShell({ firebase: firebaseStub(), officeRuntime: { officeId: "office-alqiq" } });
}

// --- TEST 1 -----------------------------------------------------------------

test("TEST 1: the office card offers one settings entry point — the display image", async () => {
  const context = await shell();
  try {
    const { document } = context;
    const card = document.querySelector("section.card.license");
    assert.ok(card, "the office card section must exist");

    const logo = document.getElementById("officeSettingsBtn");
    assert.ok(logo && card.contains(logo), "the display image entry point must live on the office card");
    assert.equal(document.getElementById("officeCardCoverWrap"), null, "office card banner must be removed");
    assert.equal(document.getElementById("officeCardCover"), null, "office card cover image must be removed");

    assert.equal(logo.tagName, "BUTTON");
    assert.equal(logo.getAttribute("type"), "button");
    assert.ok(
      (logo.getAttribute("aria-label") || "").includes("إعدادات المكتب"),
      "the entry point needs an accessible name naming the settings"
    );
  } finally {
    context.close();
  }
});

test("TEST 1: clicking the office display image opens Office Settings", async () => {
  const context = await shell();
  try {
    const { document, window } = context;
    const overlay = document.getElementById("officeSettings");
    assert.equal(overlay.hasAttribute("hidden"), true, "settings must start closed");

    document.getElementById("officeSettingsBtn").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true })
    );
    assert.equal(overlay.hasAttribute("hidden"), false, "settings must open on logo click");
  } finally {
    context.close();
  }
});

test("TEST 1: no office card banner exists on the home page", async () => {
  const context = await shell();
  try {
    const { document } = context;
    assert.equal(document.getElementById("officeCardCoverWrap"), null);
    assert.equal(document.querySelector(".office-cover"), null);
  } finally {
    context.close();
  }
});

test("TEST 1: the display image responds to Enter and Space", async () => {
  for (const key of ["Enter", " "]) {
    const context = await shell();
    try {
      const { document, window } = context;
      const overlay = document.getElementById("officeSettings");
      document.getElementById("officeSettingsBtn").dispatchEvent(
        new window.KeyboardEvent("keydown", { key, bubbles: true })
      );
      assert.equal(
        overlay.hasAttribute("hidden"),
        false,
        `officeSettingsBtn must open settings on ${key === " " ? "Space" : key}`
      );
    } finally {
      context.close();
    }
  }
});

test("TEST 1: closing returns the sheet to hidden and restores page scrolling", async () => {
  const context = await shell();
  try {
    const { document, window } = context;
    const overlay = document.getElementById("officeSettings");
    document.getElementById("officeSettingsBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(document.body.style.overflow, "hidden");

    document.getElementById("officeSettingsClose").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(overlay.hasAttribute("hidden"), true);
    assert.equal(document.body.style.overflow, "");
  } finally {
    context.close();
  }
});

test("TEST 1: Escape closes the settings sheet", async () => {
  const context = await shell();
  try {
    const { document, window } = context;
    const overlay = document.getElementById("officeSettings");
    document.getElementById("officeSettingsBtn").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(overlay.hasAttribute("hidden"), true);
  } finally {
    context.close();
  }
});

test("TEST 1: no visible standalone settings control exists on the home page", async () => {
  const context = await shell();
  try {
    const { document } = context;
    const sheet = document.getElementById("officeSettings");

    // Any element whose *visible* text names the settings, outside the sheet itself, would
    // be the forbidden standalone button.
    const offenders = Array.from(document.querySelectorAll("button, a, [role=button]"))
      .filter(node => !sheet.contains(node))
      .filter(node => {
        const visibleText = Array.from(node.childNodes)
          .filter(child => child.nodeType === 3 || !child.classList || !child.classList.contains("visually-hidden"))
          .map(child => child.textContent || "")
          .join(" ");
        return visibleText.includes("إعدادات المكتب");
      });
    assert.deepEqual(
      offenders.map(node => node.outerHTML.slice(0, 120)),
      [],
      "the settings must be reachable only through the logo and the cover"
    );
  } finally {
    context.close();
  }
});

test("TEST 1: the accessible names of the entry points are not rendered as visible labels", () => {
  // The previous shell put a literal <span>إعدادات المكتب</span> inside the logo button.
  assert.equal(
    /<span>\s*إعدادات المكتب\s*<\/span>/.test(shellSource),
    false,
    "the visible settings label must stay removed"
  );
  assert.ok(shellSource.includes('class="visually-hidden">فتح إعدادات المكتب'));
});

// --- TEST 2 -----------------------------------------------------------------

test("TEST 2: the home page has main tabs but no bottom navigation bar", async () => {
  const context = await shell();
  try {
    const { document } = context;
    assert.ok(document.getElementById("mainTabs"));
    assert.ok(document.querySelector("#mainTabs[role=tablist]"));
    assert.equal(document.querySelector(".bottom-nav"), null);
    assert.equal(document.querySelector("[data-main='deals']"), null);
  } finally {
    context.close();
  }
});

test("TEST 2: no element is named like a bottom bar or tab bar", async () => {
  const context = await shell();
  try {
    const { document } = context;
    const offenders = Array.from(document.querySelectorAll("*")).filter(node => {
      const identity = `${node.className || ""} ${node.id || ""}`;
      return /bottom[-_ ]?nav|nav[-_ ]?bar|navbar|tab[-_ ]?bar|bottom[-_ ]?bar|footer[-_ ]?nav/i.test(identity);
    });
    assert.deepEqual(offenders.map(node => node.id || node.className), []);
    assert.equal(/bottom-?nav|tab-?bar|navbar/i.test(context.styles), false, "no stylesheet rule may define one");
  } finally {
    context.close();
  }
});

test("TEST 2/5: the home page contains only the approved sections", async () => {
  const context = await shell();
  try {
    const { document } = context;
    const app = document.querySelector(".app");
    const sections = Array.from(app.children).map(node => `${node.tagName.toLowerCase()}.${node.className}`);
    assert.deepEqual(sections, [
      "header.card header",
      "section.card license",
      "section.card services-bar",
      "div.app-content-shell"
    ]);
  } finally {
    context.close();
  }
});

test("TEST 2: nothing outside the app shell could act as a fixed bottom bar", async () => {
  const context = await shell();
  try {
    const { document } = context;
    const bodyChildren = Array.from(document.body.children)
      .filter(node => node.tagName !== "SCRIPT")
      .map(node => `${node.tagName.toLowerCase()}#${node.id || ""}.${node.getAttribute("class") || ""}`);
    assert.deepEqual(bodyChildren, [
      "svg#.",
      "div#.app",
      "div#opportunityReviewOverlay.settings-overlay",
      "div#advertiserMessageOverlay.settings-overlay",
      "div#stopShareOverlay.settings-overlay",
      "div#permanentDeleteOverlay.settings-overlay",
      "div#officeSettings.settings-overlay",
      "div#toast.toast"
    ]);
  } finally {
    context.close();
  }
});

// --- TEST 14 ----------------------------------------------------------------

test("TEST 14: no deals page, tab or navigation item exists", async () => {
  const context = await shell();
  try {
    const { document } = context;
    assert.equal(document.querySelector("[data-main]"), null, "the tab strip must be gone");
    assert.equal(document.querySelector(".main-sections"), null);

    const offenders = Array.from(document.querySelectorAll("button, a, [role=button], li"))
      .filter(node => (node.textContent || "").includes("الصفقات"));
    assert.deepEqual(offenders.map(node => node.outerHTML.slice(0, 120)), []);
  } finally {
    context.close();
  }
});

test("TEST 14: the shell source carries no deals navigation remnants", () => {
  assert.equal(shellSource.includes('data-main="deals"'), false);
  assert.equal(shellSource.includes("main-sections"), false);
  assert.equal(/<strong>\s*الصفقات\s*<\/strong>/.test(shellSource), false);
});

test("TEST 14: deal records still surface — folding the tab hid nothing", async () => {
  const context = await shell();
  try {
    const { document, window } = context;
    window.dispatchEvent(new window.CustomEvent("iaqar:operations-data", {
      detail: {
        authoritative: true,
        items: [
          {
            id: "deal-1", main: "deals", priority: 1, isAlert: false, icon: "i-briefcase-check",
            title: "صفقة قيد التنفيذ", subtitle: "فيلا — العزيزية", time: "الآن",
            details: "تفاصيل", recordType: "deal", recordId: "deal-1"
          },
          {
            id: "match-1", main: "opportunities", priority: 0, isAlert: true, icon: "i-match",
            title: "مطابقة بنسبة 88%", subtitle: "طلب عميل مع عرض مالك", time: "الآن",
            details: "تفاصيل", recordType: "match", recordId: "match-1"
          }
        ]
      }
    }));

    const rendered = Array.from(document.querySelectorAll(".operation h3")).map(node => node.textContent.trim());
    assert.deepEqual(rendered, ["مطابقة بنسبة 88%", "صفقة قيد التنفيذ"], "one list, sorted by priority");
    assert.equal(document.getElementById("total").textContent, "2");
    assert.equal(document.getElementById("operationsEmpty").hidden, true);
  } finally {
    context.close();
  }
});

// --- TEST 15 (shell half) ---------------------------------------------------

test("TEST 15: the Operations Center ships empty, with the approved empty state visible", async () => {
  const context = await shell();
  try {
    const { document } = context;
    assert.equal(document.querySelectorAll(".operation").length, 0, "no fabricated operation may render");
    assert.equal(document.getElementById("operationList").innerHTML.trim(), "");
    assert.equal(document.getElementById("total").textContent, "0");

    const empty = document.getElementById("operationsEmpty");
    assert.ok(empty, "an empty state must exist");
    assert.equal(empty.hidden, false, "the empty state must be visible when there is nothing to do");
    assert.ok(empty.textContent.includes("لا توجد إجراءات تحتاج انتباهك حاليًا"));
    assert.ok(empty.textContent.includes("ستظهر الفرص المباشرة هنا"));
  } finally {
    context.close();
  }
});

test("TEST 15: the previous hard-coded demo operations are gone from the source", () => {
  for (const fragment of [
    "طلب شراء شقة",
    "متابعة مالك عقار",
    "صفقة جاهزة للإغلاق",
    "اتفاقية وساطة بانتظار الاعتماد",
    "عرض مناسب لطلب قائم",
    "مطابقة بنسبة 91%",
    "حي الدفاع"
  ]) {
    assert.equal(shellSource.includes(fragment), false, `demo content still present: ${fragment}`);
  }
});

test("TEST 15: the empty state returns after real records are cleared", async () => {
  const context = await shell();
  try {
    const { document, window } = context;
    const fire = items => window.dispatchEvent(new window.CustomEvent("iaqar:operations-data", {
      detail: { authoritative: true, items }
    }));

    fire([{
      id: "match-1", main: "opportunities", priority: 0, isAlert: false, icon: "i-match",
      title: "مطابقة", subtitle: "تفاصيل", time: "الآن", details: "تفاصيل"
    }]);
    assert.equal(document.getElementById("operationsEmpty").hidden, true);

    fire([]);
    assert.equal(document.getElementById("operationsEmpty").hidden, false);
    assert.equal(document.getElementById("total").textContent, "0");
  } finally {
    context.close();
  }
});

// --- Approved office card content (directive §6) -----------------------------

test("the office card shows logo, cover, name, broker, license, city; services bar shows specialties", async () => {
  const context = await shell();
  try {
    const { document } = context;
    const card = document.querySelector("section.card.license");
    for (const id of [
      "officeDisplayName",
      "officeDisplayBroker",
      "officeDisplayLicense",
      "officeDisplayCity"
    ]) {
      assert.ok(card.querySelector(`#${id}`), `${id} must be on the office card`);
    }
    assert.ok(document.getElementById("officeDisplaySpecialties"), "services bar must show specialties");
    assert.ok(document.getElementById("officeServicesBar"), "services bar section required");
    assert.ok(card.querySelector("#officeSettingsBtn img"), "the logo image must render on the card");
  } finally {
    context.close();
  }
});

test("the office card has no in-card banner region", async () => {
  const context = await shell();
  try {
    const { document } = context;
    assert.equal(document.getElementById("officeCardCoverWrap"), null);
    assert.equal(document.getElementById("officeCardCover"), null);
    assert.equal(document.querySelector("section.card.license .office-cover"), null);
  } finally {
    context.close();
  }
});
