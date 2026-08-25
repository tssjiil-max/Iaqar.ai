// Phase 1 Office Settings surface: the approved sections exist, the field list is exactly
// the approved one, and nothing forbidden is present.
// Directive §7.1–§7.7.

import test from "node:test";
import assert from "node:assert/strict";
import { firebaseStub, loadShell, readRepositoryFile } from "./helpers/shell.mjs";

const shellSource = readRepositoryFile("public", "index.html");

async function shell() {
  return loadShell({ firebase: firebaseStub(), officeRuntime: { officeId: "office-alqiq" } });
}

test("all approved settings sections are present", async () => {
  const context = await shell();
  try {
    const sheet = context.document.getElementById("officeSettings");
    for (const [id, heading] of [
      ["officeIdentitySection", "الهوية البصرية"],
      ["officeLinkSection", "رابط المكتب"],
      ["cooperationSection", "التعاون بين المكاتب"],
      ["notificationPrefsSection", "الإشعارات"]
    ]) {
      const section = sheet.querySelector(`#${id}`);
      assert.ok(section, `${id} must exist inside the settings sheet`);
      assert.equal(section.querySelector("h3").textContent.trim(), heading);
    }
    assert.ok(sheet.querySelector("#officeProfileForm"), "the office data form must exist");
  } finally {
    context.close();
  }
});

// --- 7.2 office data --------------------------------------------------------

test("the office data form exposes exactly the five approved fields", async () => {
  const context = await shell();
  try {
    const form = context.document.getElementById("officeProfileForm");
    const inputs = Array.from(form.querySelectorAll("input"))
      .filter(input => input.type !== "checkbox" && input.type !== "radio")
      .map(input => input.id);
    assert.deepEqual(inputs, [
      "officeNameInput",
      "brokerNameInput",
      "licenseNumberInput",
      "officeCityInput",
      "officePhoneInput"
    ]);
  } finally {
    context.close();
  }
});

test("no email field appears anywhere in Office Settings", async () => {
  const context = await shell();
  try {
    const sheet = context.document.getElementById("officeSettings");
    assert.equal(sheet.querySelector('input[type="email"]'), null);
    assert.equal(sheet.querySelector('input[name*="mail" i]'), null);
    assert.equal(/بريد|إيميل|e-?mail/i.test(sheet.textContent), false, "no email wording either");
  } finally {
    context.close();
  }
});

test("the second WhatsApp number field is gone from the visible settings", async () => {
  const context = await shell();
  try {
    const sheet = context.document.getElementById("officeSettings");
    assert.equal(sheet.querySelector("#officeWhatsappInput"), null);
    assert.equal(sheet.querySelector('input[name="whatsapp"]'), null);
  } finally {
    context.close();
  }
});

test("the whatsapp value is still derived and persisted, so nothing downstream breaks", () => {
  // docs/DECISIONS.md D-002: the field stays in the data model, derived from the mobile
  // number, because the public office page and every wa.me link read it.
  const settings = readRepositoryFile("public", "js", "office-settings.js");
  assert.ok(settings.includes("whatsapp: safeText(data.whatsapp || phone)"));
  assert.ok(settings.includes("whatsapp: el.phone.value"), "saving must carry the derived value");
  assert.ok(settings.includes("whatsapp: data.whatsapp"), "the public projection must keep it");
});

test("the office name field advertises the four-character rule and an availability status", async () => {
  const context = await shell();
  try {
    const { document } = context;
    const input = document.getElementById("officeNameInput");
    assert.equal(input.getAttribute("minlength"), "4");
    assert.equal(input.getAttribute("maxlength"), "80");
    assert.equal(input.hasAttribute("required"), true);
    const availability = document.getElementById("officeNameAvailability");
    assert.ok(availability, "an availability status region must exist");
    assert.equal(availability.getAttribute("role"), "status");
  } finally {
    context.close();
  }
});

// --- 7.1 visual identity ----------------------------------------------------

test("each identity variant has a full upload workflow in the markup", async () => {
  const context = await shell();
  try {
    const { document } = context;
    for (const variant of ["logo"]) {
      const slot = document.querySelector(`[data-image-variant="${variant}"]`);
      assert.ok(slot, `${variant} slot must exist`);
      for (const role of ["preview", "preview-image", "placeholder", "crop", "offset-x", "offset-y", "choose", "save", "file", "status"]) {
        assert.ok(slot.querySelector(`[data-role="${role}"]`), `${variant} is missing ${role}`);
      }
      const file = slot.querySelector('[data-role="file"]');
      assert.equal(file.getAttribute("accept"), "image/jpeg,image/png,image/webp");
      assert.ok(file.getAttribute("aria-label"), `${variant} file input needs an accessible name`);
      assert.equal(slot.querySelector('[data-role="status"]').getAttribute("role"), "status");
    }
    assert.equal(document.querySelector('[data-image-variant="display"]'), null, "unused display slot removed");
  } finally {
    context.close();
  }
});

test("remove is offered only for the variants the directive allows removing", async () => {
  const context = await shell();
  try {
    const { document } = context;
    assert.ok(document.querySelector('[data-image-variant="logo"] [data-role="remove"]'));
    assert.equal(document.querySelector('[data-image-variant="display"]'), null);
    assert.equal(document.querySelector('[data-image-variant="cover"]'), null);
  } finally {
    context.close();
  }
});

test("the preview aspect ratio is taken from the preset at runtime, not hard-coded", async () => {
  const context = await shell();
  try {
    const { document } = context;
    const logoWrap = document.querySelector('[data-image-variant="logo"] .office-logo-preview-wrap');
    assert.ok(logoWrap, "logo preview wrap should exist");
    assert.ok(logoWrap.classList.contains("office-logo-preview-wrap"));
    const sizeHint = document.querySelector('[data-image-variant="logo"] .office-logo-size-hint');
    assert.ok(sizeHint);
    assert.equal(sizeHint.textContent, "المقاس الموصى به: 512×512");
    assert.equal(document.querySelector('[data-image-variant="cover"]'), null);
  } finally {
    context.close();
  }
});

test("choosing a file with a rejected type reports the error and enables nothing", async () => {
  const context = await shell();
  try {
    const { document, window } = context;
    const slot = document.querySelector('[data-image-variant="logo"]');
    const file = slot.querySelector('[data-role="file"]');
    const save = slot.querySelector('[data-role="save"]');
    assert.equal(save.disabled, true, "save starts disabled");

    Object.defineProperty(file, "files", {
      value: [{ type: "image/gif", size: 1024, name: "x.gif" }],
      configurable: true
    });
    file.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const status = slot.querySelector('[data-role="status"]');
    assert.ok(status.textContent.includes("JPG"), `expected a type error, got: ${status.textContent}`);
    assert.ok(status.classList.contains("is-error"));
    assert.equal(save.disabled, true, "an invalid file must never enable saving");
  } finally {
    context.close();
  }
});

test("an oversized file is rejected before any upload is attempted", async () => {
  let fetchCalls = 0;
  const context = await loadShell({
    firebase: firebaseStub(),
    officeRuntime: { officeId: "office-alqiq" },
    fetch: async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    }
  });
  try {
    const { document, window } = context;
    const slot = document.querySelector('[data-image-variant="logo"]');
    const file = slot.querySelector('[data-role="file"]');
    Object.defineProperty(file, "files", {
      value: [{ type: "image/png", size: 11 * 1024 * 1024, name: "big.png" }],
      configurable: true
    });
    file.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.ok(slot.querySelector('[data-role="status"]').textContent.includes("ميجابايت"));
    assert.equal(fetchCalls, 0, "no network call may be made for a rejected file");
  } finally {
    context.close();
  }
});

// --- 7.4 office link --------------------------------------------------------

test("the office link section offers a single share-office-link action", async () => {
  const context = await shell();
  try {
    const { document } = context;
    const section = document.getElementById("officeLinkSection");
    assert.ok(section.querySelector("#shareOfficeLinkCardBtn"), "shareOfficeLinkCardBtn required");
    assert.ok(section.querySelector("#officeLinkInput"), "hidden officeLinkInput required");
    assert.equal(section.querySelector("#copyOfficeLinkBtn"), null);
    assert.equal(section.querySelector("#toggleOfficeQrBtn"), null);
    assert.equal(section.querySelector("#previewOfficeLinkBtn"), null);
    assert.equal(section.querySelector("#shareOfficeCardBtn"), null);
  } finally {
    context.close();
  }
});

test("the office link is a real per-office URL, not a placeholder", async () => {
  const context = await shell();
  try {
    const value = context.document.getElementById("officeLinkInput").value;
    assert.ok(value.startsWith("https://iaqar.ai/"), value);
    assert.ok(value.includes("office-alqiq"), `the link must identify the office: ${value}`);
  } finally {
    context.close();
  }
});

// --- 7.6 opportunity bank entry --------------------------------------------

test("the opportunity bank lives under Opportunities, not Office Settings", async () => {
  const context = await shell();
  try {
    const { document } = context;
    assert.equal(document.getElementById("openOpportunityBankBtn"), null);
    assert.equal(document.getElementById("opportunityBankSection"), null);
    assert.ok(document.getElementById("oppTabBank"));
    assert.ok(document.getElementById("mainTabOpportunities"));
    assert.ok(document.querySelector(".app").contains(document.getElementById("opportunityBank")));
    assert.equal(document.getElementById("officeSettings").contains(document.getElementById("opportunityBank")), false);
  } finally {
    context.close();
  }
});

test("the العروض والطلبات sub-tab reveals the inline bank panel", async () => {
  const context = await loadShell({ bootSettingsModule: true });
  try {
    const { document } = context;
    assert.equal(document.getElementById("opportunityBank").dataset.inlineBank, "1");
    assert.equal(document.getElementById("mainPanelOpportunities").hasAttribute("hidden"), true);
    document.getElementById("mainTabOpportunities").click();
    assert.equal(document.getElementById("oppPanelBank").hasAttribute("hidden"), false);
    assert.equal(document.getElementById("opportunityBankTitle").textContent.trim(), "العروض والطلبات");
  } finally {
    context.close();
  }
});

// --- Forbidden additions ----------------------------------------------------

test("no unrequested opportunity status label is present anywhere in the shell", () => {
  for (const label of ["فرصة مرصودة", "فرصة قيد المتابعة", "فرصة غير مطابقة"]) {
    assert.equal(shellSource.includes(label), false, `forbidden label present: ${label}`);
  }
});

test("internal lifecycle statuses are not shown to the broker", () => {
  const sheetSource = shellSource.slice(shellSource.indexOf('id="officeSettings"'));
  for (const status of ["INGESTED", "ANALYZING", "NEEDS_DATA", "MATCHED", "ARCHIVED"]) {
    assert.equal(sheetSource.includes(status), false, `internal status leaked: ${status}`);
  }
});
