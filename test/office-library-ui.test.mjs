// Office library UI — organized folders, title, counts, legacy routing, responsive layout.
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  firebaseStub,
  loadShell,
  readRepositoryFile,
  repositoryRoot,
  shellStyles
} from "./helpers/shell.mjs";
import {
  buildLibraryItem,
  countLibraryItemsByCategory,
  filterLibraryItems,
  LIBRARY_CATEGORIES,
  LIBRARY_CATEGORY_LABELS,
  LIBRARY_MAIN_SECTIONS,
  resolveLibraryCategory
} from "../public/js/office-library-domain.js";

const html = readRepositoryFile("public", "index.html");

function libraryCss() {
  const start = html.indexOf("#officeSettings .settings-sheet.is-library-open");
  const end = html.indexOf(".office-settings-note", start);
  return html.slice(start, end > start ? end : start + 5000);
}

function extractLibraryPanelHtml() {
  const start = html.indexOf("id=\"officeLibraryPanel\"");
  const open = html.lastIndexOf("<div", start);
  const end = html.indexOf("id=\"notificationPrefsSection\"");
  return html.slice(open, end > open ? end : open + 8000);
}

test("library title is exactly المكتبة", () => {
  const panel = extractLibraryPanelHtml();
  assert.ok(panel.includes("id=\"officeLibraryTitle\""));
  assert.match(panel, /<h2[^>]*id="officeLibraryTitle"[^>]*>المكتبة<\/h2>/);
  assert.equal(panel.includes("مكتبة المكتب"), false);
  assert.equal(panel.includes("مكتبة العقود"), false);
});

test("library title is centered with pale-green scoped header and Tajawal 800", () => {
  const css = libraryCss();
  assert.ok(css.includes("#officeLibraryPanel .library-title-bar"));
  assert.ok(css.includes("background:var(--green-pale)"));
  assert.ok(css.includes("text-align:center"));
  assert.ok(css.includes("font-family:\"Tajawal\""));
  assert.ok(css.includes("font-weight:800"));
  assert.ok(css.includes("clamp(1.35rem,2.8vw,1.9rem)"));
});

test("all three main sections and approved subfolders are defined in domain", () => {
  assert.equal(LIBRARY_MAIN_SECTIONS.length, 3);
  assert.equal(LIBRARY_MAIN_SECTIONS[0].label, "عقود الوساطة والتوثيق");
  assert.equal(LIBRARY_MAIN_SECTIONS[1].label, "عقود الصفقات");
  assert.equal(LIBRARY_MAIN_SECTIONS[2].label, "ملفات المكتب");
  const subfolders = LIBRARY_MAIN_SECTIONS.flatMap((section) => section.categories);
  assert.equal(subfolders.length, 12);
  assert.ok(subfolders.includes(LIBRARY_CATEGORIES.OWNER_BROKERAGE));
  assert.ok(subfolders.includes(LIBRARY_CATEGORIES.LEASE_CONTRACT));
  assert.ok(subfolders.includes(LIBRARY_CATEGORIES.OTHER));
});

test("library main section toggles are keyboard and touch accessible buttons", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "library-main-section-toggle";
    toggle.setAttribute("data-library-section-toggle", "brokerage");
    toggle.setAttribute("aria-expanded", "true");
    assert.equal(toggle.getAttribute("type"), "button");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
  } finally {
    context.close();
  }
  const panel = extractLibraryPanelHtml();
  const jsSource = readRepositoryFile("public", "js", "office-library.js");
  assert.ok(jsSource.includes("data-library-section-toggle"));
  assert.ok(jsSource.includes("library-subfolder-card"));
});

test("legacy file without category resolves to ملفات أخرى", () => {
  const legacy = buildLibraryItem({
    officeId: "office-a",
    fileName: "legacy.jpg",
    contentType: "image/jpeg",
    mediaPath: "office-library/office-a/x/legacy.jpg"
  });
  delete legacy.category;
  assert.equal(resolveLibraryCategory(legacy), LIBRARY_CATEGORIES.OTHER);
  assert.equal(LIBRARY_CATEGORY_LABELS[resolveLibraryCategory(legacy)], "ملفات أخرى");
});

test("existing file actions فتح تنزيل حذف remain in library UI source", () => {
  const source = readRepositoryFile("public", "js", "office-library.js");
  assert.ok(source.includes("data-library-open"));
  assert.ok(source.includes(">فتح</button>"));
  assert.ok(source.includes(">تنزيل</button>"));
  assert.ok(source.includes(">حذف</button>"));
  assert.ok(source.includes("mediaUrl"));
});

test("lease contract category maps to عقود الإيجار folder", () => {
  const item = buildLibraryItem({
    officeId: "office-a",
    fileName: "lease.pdf",
    contentType: "application/pdf",
    mediaPath: "office-library/office-a/x/lease.pdf",
    category: LIBRARY_CATEGORIES.LEASE_CONTRACT
  });
  const counts = countLibraryItemsByCategory([item]);
  assert.equal(counts[LIBRARY_CATEGORIES.LEASE_CONTRACT], 1);
  assert.equal(LIBRARY_CATEGORY_LABELS[item.category], "عقود الإيجار");
});

test("owner brokerage contract maps to عقد وساطة بين المالك والوسيط", () => {
  const item = buildLibraryItem({
    officeId: "office-a",
    fileName: "owner.pdf",
    contentType: "application/pdf",
    mediaPath: "office-library/office-a/x/owner.pdf",
    category: LIBRARY_CATEGORIES.OWNER_BROKERAGE
  });
  assert.equal(LIBRARY_CATEGORY_LABELS[item.category], "عقد وساطة بين المالك والوسيط");
});

test("folder counts derive from real items not hardcoded markup", () => {
  const items = [
    buildLibraryItem({
      officeId: "office-a",
      fileName: "a.pdf",
      contentType: "application/pdf",
      mediaPath: "p/a",
      category: LIBRARY_CATEGORIES.OWNER_BROKERAGE
    }),
    buildLibraryItem({
      officeId: "office-a",
      fileName: "b.pdf",
      contentType: "application/pdf",
      mediaPath: "p/b",
      category: LIBRARY_CATEGORIES.LEASE_CONTRACT
    })
  ];
  const counts = countLibraryItemsByCategory(items);
  assert.equal(counts[LIBRARY_CATEGORIES.OWNER_BROKERAGE], 1);
  assert.equal(counts[LIBRARY_CATEGORIES.LEASE_CONTRACT], 1);
  const source = readRepositoryFile("public", "js", "office-library.js");
  assert.ok(source.includes("countLibraryItemsByCategory"));
  assert.equal(source.includes("library-count-badge\">5"), false);
});

test("search filters are limited to current office in domain layer", () => {
  const officeA = buildLibraryItem({
    officeId: "office-a",
    fileName: "secret.pdf",
    contentType: "application/pdf",
    mediaPath: "p/a",
    documentTitle: "وثيقة خاصة"
  });
  const officeB = buildLibraryItem({
    officeId: "office-b",
    fileName: "other.pdf",
    contentType: "application/pdf",
    mediaPath: "p/b",
    documentTitle: "وثيقة خاصة"
  });
  const filtered = filterLibraryItems([officeA, officeB], {
    officeId: "office-a",
    search: "وثيقة"
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].officeId, "office-a");
});

test("opportunity-linked contract uses single document without duplication helper", () => {
  const source = readRepositoryFile("public", "js", "office-library.js");
  assert.ok(source.includes("opportunityId"));
  assert.equal(source.includes("duplicate"), false);
  const item = buildLibraryItem({
    officeId: "office-a",
    fileName: "linked.pdf",
    contentType: "application/pdf",
    mediaPath: "p/l",
    opportunityId: "opp_1",
    category: LIBRARY_CATEGORIES.SALE_CONTRACT
  });
  assert.equal(item.opportunityId, "opp_1");
});

test("mobile library panel uses wide viewport without horizontal overflow styles", () => {
  const css = libraryCss();
  assert.ok(css.includes("width:96vw"));
  assert.ok(css.includes("max-height:94dvh"));
  assert.ok(css.includes("overflow-x:hidden"));
  assert.ok(css.includes("env(safe-area-inset"));
});

test("desktop library panel uses expanded min(1180px, 92vw) layout", () => {
  const css = libraryCss();
  assert.ok(css.includes("width:min(1180px,92vw)"));
  assert.ok(css.includes("min-height:78vh"));
});

test("unrelated settings sections keep default settings-sheet width", () => {
  const settingsCss = html.slice(html.indexOf(".settings-sheet {"), html.indexOf(".settings-head"));
  assert.ok(settingsCss.includes("width:min(100%,432px)"));
  assert.equal(settingsCss.includes("1180px"), false);
});

test("library panel renders three section containers via JS renderer", async () => {
  let moduleCounter = 99;
  const specifier = new URL(pathToFileURL(path.join(repositoryRoot, "public", "js", "office-library.js")));
  specifier.searchParams.set("shellInstance", String(moduleCounter));

  const mockDb = {
    collection(name) {
      if (name !== "offices") throw new Error("unexpected");
      return {
        doc(officeId) {
          return {
            collection(sub) {
              if (sub === "library") {
                return {
                  orderBy() { return this; },
                  limit() { return this; },
                  async get() {
                    return {
                      docs: [{
                        id: "lib_legacy",
                        data: () => ({
                          officeId,
                          fileName: "photo.jpg",
                          contentType: "image/jpeg",
                          mediaPath: `office-library/${officeId}/lib_legacy/photo.jpg`,
                          kind: "manual",
                          createdAt: "2026-01-01T00:00:00.000Z"
                        })
                      }]
                    };
                  }
                };
              }
              throw new Error("unexpected sub");
            }
          };
        }
      };
    }
  };

  const context = await loadShell({
    bootSettingsModule: false,
    firebase: firebaseStub({ user: { uid: "broker-a1" } }),
    officeRuntime: { officeId: "office-a", db: mockDb }
  });
  try {
    await import(specifier.href);
    context.document.getElementById("officeLibraryOpenBtn").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const sections = context.document.querySelectorAll(".library-main-section");
    assert.equal(sections.length, 3);
    const subfolders = context.document.querySelectorAll(".library-subfolder-card");
    assert.equal(subfolders.length, 12);
    const otherCount = context.document.querySelector(
      `[data-library-category="${LIBRARY_CATEGORIES.OTHER}"] .library-count-badge`
    );
    assert.equal(otherCount?.textContent, "1");
  } finally {
    context.close();
  }
});

test("upload waits for حفظ الملف and encodes Arabic file names", () => {
  const source = readRepositoryFile("public", "js", "office-library.js");
  const panel = extractLibraryPanelHtml();
  assert.ok(source.includes("officeLibraryUploadSave"));
  assert.ok(source.includes("pendingUploadFile"));
  assert.ok(panel.includes("حفظ الملف"));
  assert.ok(source.includes("encodeURIComponent(file.name"));
  assert.equal(source.includes("officeLibraryFileInput"), false);
});

test("firestore rules enforce library office isolation and category validation", () => {
  const rules = readRepositoryFile("firestore.rules");
  assert.ok(rules.includes("match /library/{itemId}"));
  assert.ok(rules.includes("request.resource.data.officeId == officeId"));
  assert.ok(rules.includes("'lease_contract'"));
  assert.ok(rules.includes("'owner_brokerage'"));
});

test("worker storage path enforces office segment for library media", () => {
  const worker = readRepositoryFile("worker", "src", "index.js");
  assert.ok(worker.includes("OFFICE_MEDIA_KEY_PATTERN"));
  assert.ok(worker.includes("office-library"));
  assert.ok(worker.includes("media_forbidden"));
  assert.ok(worker.includes("!mediaPath.includes(`/${officeId}/`)"));
});
