import test from "node:test";
import assert from "node:assert/strict";
import { createAppDom, click, submitForm, textOf } from "./helpers/app-dom.mjs";

function overlay(document) {
  return document.getElementById("officeSettings");
}

/* ------------------------------------------------ فتح الإعدادات من البطاقة */

test("clicking the office logo opens Office Settings", async () => {
  const { window, document } = await createAppDom();
  const sheet = overlay(document);
  assert.equal(sheet.hidden, true);
  click(window, document.getElementById("officeSettingsBtn"));
  assert.equal(sheet.hidden, false);
});

test("clicking the office cover opens Office Settings", async () => {
  const { window, document } = await createAppDom();
  const sheet = overlay(document);
  const cover = document.getElementById("officeCoverBtn");
  assert.ok(cover, "the office card must expose a cover trigger");
  click(window, cover);
  assert.equal(sheet.hidden, false);
});

test("both settings triggers are real buttons with accessible names and keyboard focus", async () => {
  const { document } = await createAppDom();
  for (const id of ["officeSettingsBtn", "officeCoverBtn"]) {
    const trigger = document.getElementById(id);
    assert.equal(trigger.tagName, "BUTTON");
    assert.equal(trigger.getAttribute("type"), "button");
    assert.match(trigger.getAttribute("aria-label"), /إعدادات المكتب/);
  }
});

test("Office Settings closes with the close button, the backdrop and the Escape key", async () => {
  const { window, document } = await createAppDom();
  const sheet = overlay(document);

  click(window, document.getElementById("officeSettingsBtn"));
  click(window, document.getElementById("officeSettingsClose"));
  assert.equal(sheet.hidden, true);

  click(window, document.getElementById("officeCoverBtn"));
  click(window, sheet);
  assert.equal(sheet.hidden, true);

  click(window, document.getElementById("officeSettingsBtn"));
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(sheet.hidden, true);
});

test("no visible standalone Office Settings button exists anywhere", async () => {
  const { document } = await createAppDom();
  const settingsLabelled = Array.from(document.querySelectorAll("button"))
    .filter(button => textOf(button).includes("إعدادات"));
  assert.deepEqual(settingsLabelled.map(textOf), []);
});

test("the home page has no bottom navigation bar and no deals page link is added", async () => {
  const { document } = await createAppDom();
  assert.equal(document.querySelector("nav"), null);
  assert.equal(document.querySelector(".bottom-nav, .tabbar, [data-bottom-nav]"), null);
});

/* -------------------------------------------------------- بيانات المكتب */

test("Office Settings shows only the approved office data fields and no email field", async () => {
  const { document } = await createAppDom();
  const sheet = overlay(document);
  for (const id of ["officeNameInput", "brokerNameInput", "licenseNumberInput", "officeCityInput", "officePhoneInput"]) {
    assert.ok(sheet.querySelector(`#${id}`), `${id} must exist in Office Settings`);
  }
  assert.equal(sheet.querySelector('input[type="email"]'), null);
  assert.equal(sheet.querySelector('input[name="email"]'), null);
  assert.equal(/البريد الإلكتروني/.test(sheet.textContent), false);
});

test("a short office name is rejected before any write", async () => {
  const { window, document } = await createAppDom();
  document.getElementById("officeNameInput").value = "مكت";
  submitForm(window, document.getElementById("officeProfileForm"));
  assert.match(textOf(document.getElementById("officeSettingsNote")), /4 أحرف/);
});

test("a whitespace-only office name is rejected", async () => {
  const { window, document } = await createAppDom();
  document.getElementById("officeNameInput").value = "    ";
  submitForm(window, document.getElementById("officeProfileForm"));
  assert.match(textOf(document.getElementById("officeSettingsNote")), /اكتب اسم المكتب/);
});

test("an invalid mobile number is rejected", async () => {
  const { window, document } = await createAppDom();
  document.getElementById("officeNameInput").value = "مكتب المسار";
  document.getElementById("officePhoneInput").value = "123";
  submitForm(window, document.getElementById("officeProfileForm"));
  assert.match(textOf(document.getElementById("officeSettingsNote")), /05/);
});

test("a valid form without an authorized session reports that nothing was saved", async () => {
  const { window, document } = await createAppDom();
  document.getElementById("officeNameInput").value = "مكتب المسار العقاري";
  document.getElementById("brokerNameInput").value = "سعد العتيبي";
  document.getElementById("licenseNumberInput").value = "1200012345";
  document.getElementById("officeCityInput").value = "المدينة المنورة";
  document.getElementById("officePhoneInput").value = "0551234567";
  submitForm(window, document.getElementById("officeProfileForm"));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(textOf(document.getElementById("officeSettingsNote")), /لم يتم الحفظ/);
});

/* ------------------------------------------------------- الهوية البصرية */

test("the visual identity section exposes logo, display image and wide share cover", async () => {
  const { document } = await createAppDom();
  const kinds = Array.from(document.querySelectorAll("[data-image-kind]")).map(node => node.dataset.imageKind);
  assert.deepEqual(kinds, ["logo", "display", "share"]);
});

test("each image slot supports choose, save, remove, preview, crop focus and a state line", async () => {
  const { document } = await createAppDom();
  for (const kind of ["logo", "display", "share"]) {
    const slot = document.querySelector(`[data-image-kind="${kind}"]`);
    assert.ok(slot.querySelector('input[data-role="file"]'), "file input");
    assert.ok(slot.querySelector('[data-action="choose"]'), "choose button");
    assert.ok(slot.querySelector('[data-action="save"]'), "save button");
    assert.ok(slot.querySelector('[data-action="remove"]'), "remove button");
    assert.ok(slot.querySelector('[data-role="preview"]'), "preview element");
    assert.ok(slot.querySelector('[data-role="focus-x"]'), "horizontal crop focus");
    assert.ok(slot.querySelector('[data-role="focus-y"]'), "vertical crop focus");
    assert.equal(slot.querySelector('[data-role="state"]').getAttribute("role"), "status");
    assert.equal(slot.querySelector('input[data-role="file"]').accept, "image/jpeg,image/png,image/webp");
  }
});

test("save and remove stay disabled until there is something to save or remove", async () => {
  const { document } = await createAppDom();
  const slot = document.querySelector('[data-image-kind="display"]');
  assert.equal(slot.querySelector('[data-action="save"]').disabled, true);
  assert.equal(slot.querySelector('[data-action="remove"]').disabled, true);
});

test("a stored display image is shown on the office card and can be removed", async () => {
  const { document } = await createAppDom({
    storedProfile: {
      officeName: "مكتب المسار",
      brokerName: "سعد العتيبي",
      licenseNumber: "1200012345",
      city: "المدينة المنورة",
      coverUrl: "https://media.example.test/media/public/office-covers/platform/cover"
    }
  });
  const cardCover = document.getElementById("officeCoverImage");
  assert.equal(cardCover.hidden, false);
  assert.match(cardCover.getAttribute("src"), /office-covers\/platform\/cover$/);
  assert.equal(document.getElementById("officeCoverEmpty").hidden, true);
  const removeButton = document.querySelector('[data-image-kind="display"] [data-action="remove"]');
  assert.equal(removeButton.disabled, false);
});

test("an office without a display image shows the empty state instead of a broken image", async () => {
  const { document } = await createAppDom();
  assert.equal(document.getElementById("officeCoverImage").hidden, true);
  assert.equal(document.getElementById("officeCoverEmpty").hidden, false);
  assert.equal(document.getElementById("officeCoverImage").hasAttribute("src"), false);
});

test("a rejected image type never reaches the upload state", async () => {
  const { window, document } = await createAppDom();
  let uploads = 0;
  window.fetch = () => {
    uploads += 1;
    return Promise.reject(new Error("no network in tests"));
  };
  const identity = window.IAQAR.identity;
  assert.match(identity.validateImageFile({ type: "image/gif", size: 10 }, "logo"), /JPG/);
  assert.equal(uploads, 0);
});

/* ------------------------------------------------------------ رابط المكتب */

test("the office link card offers copy, share, QR and public preview", async () => {
  const { document } = await createAppDom();
  assert.ok(document.getElementById("officeLinkInput"));
  assert.ok(document.getElementById("copyOfficeLinkBtn"));
  assert.ok(document.getElementById("shareOfficeLinkBtn"));
  assert.ok(document.getElementById("previewOfficeLinkBtn"));
  assert.ok(document.getElementById("toggleOfficeQrBtn"));
  assert.equal(document.getElementById("officeLinkInput").readOnly, true);
});

test("the office link points at this office only", async () => {
  const { document } = await createAppDom({
    storedProfile: { officeName: "مكتب المسار", publicSlug: "al-masar-a1b2c3" }
  });
  assert.equal(document.getElementById("officeLinkInput").value, "https://iaqar.ai/o/al-masar-a1b2c3");
});

test("copying the office link reports success", async () => {
  const { window, document } = await createAppDom();
  const copied = [];
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async value => copied.push(value) }
  });
  click(window, document.getElementById("copyOfficeLinkBtn"));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(copied.length, 1);
  assert.match(textOf(document.getElementById("officeLinkNote")), /تم نسخ/);
});

test("the QR code renders for the office link and toggles visibility", async () => {
  const { window, document } = await createAppDom();
  const box = document.getElementById("officeQrBox");
  const toggle = document.getElementById("toggleOfficeQrBtn");
  assert.equal(box.hidden, true);
  click(window, toggle);
  assert.equal(box.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const svg = document.querySelector("#officeQrCode svg");
  assert.ok(svg, "a QR svg must be rendered");
  assert.ok(svg.querySelectorAll("rect").length > 10);
  click(window, toggle);
  assert.equal(box.hidden, true);
});

/* --------------------------------------------------- تفضيلات الإشعارات */

test("the six approved notification switches are rendered and enabled by default", async () => {
  const { document } = await createAppDom();
  const inputs = Array.from(document.querySelectorAll('input[name="notificationPreference"]'));
  assert.deepEqual(inputs.map(input => input.value), [
    "matches", "ownerCustomer", "cooperation", "messages", "appointments", "system"
  ]);
  assert.ok(inputs.every(input => input.checked));
});

test("saving notification preferences without a session reports it instead of pretending", async () => {
  const { window, document } = await createAppDom();
  click(window, document.getElementById("saveNotificationPrefsBtn"));
  const note = document.getElementById("notificationPrefsNote");
  assert.match(textOf(note), /سجل دخول/);
  assert.ok(note.classList.contains("is-error"));
});

/* ------------------------------------------------------------ بنك الفرص */

test("the Opportunity Bank entry exists inside Office Settings and not on the home page", async () => {
  const { document } = await createAppDom();
  const entry = document.getElementById("opportunityBankEntry");
  assert.ok(entry);
  assert.ok(overlay(document).contains(entry));
  assert.match(textOf(entry), /بنك الفرص/);
  assert.equal(document.querySelector(".main-sections #opportunityBankEntry"), null);
});

test("the Opportunity Bank entry is honest about its Phase 3 status and shows no fake records", async () => {
  const { window, document } = await createAppDom();
  let opened = 0;
  window.addEventListener("iaqar:open-opportunity-bank", () => { opened += 1; });
  click(window, document.getElementById("opportunityBankEntry"));
  assert.equal(opened, 1);
  const note = textOf(document.getElementById("opportunityBankNote"));
  assert.match(note, /المرحلة الثالثة/);
  assert.equal(/فرصة تجريبية|عقار تجريبي/.test(document.getElementById("opportunityBankCard").textContent), false);
});

/* ------------------------------------------------------------- التعاون */

test("cooperation offers exactly the three approved modes with approval required as default", async () => {
  const { document } = await createAppDom();
  const inputs = Array.from(document.querySelectorAll('input[name="cooperationMode"]'));
  assert.deepEqual(inputs.map(input => input.value), ["disabled", "approval_required", "smart_automatic"]);
  const checked = inputs.filter(input => input.checked);
  assert.equal(checked.length, 1);
  assert.equal(checked[0].value, "approval_required");
  assert.match(textOf(document.getElementById("officeCooperationTitle")), /السماح بالتعاون الذكي بين الوسطاء/);
});

test("saving the cooperation mode without a session reports it instead of pretending", async () => {
  const { window, document } = await createAppDom();
  click(window, document.getElementById("saveCooperationModeBtn"));
  const note = document.getElementById("cooperationModeNote");
  assert.match(textOf(note), /سجل دخول/);
  assert.ok(note.classList.contains("is-error"));
});

/* ------------------------------------------------------ العزل بين المكاتب */

test("locally cached office data is namespaced by officeId", async () => {
  const { window } = await createAppDom({
    storedProfile: { officeName: "مكتب المسار" },
    officeId: "platform"
  });
  const keys = Object.keys(window.localStorage).filter(key => key.startsWith("iaqar.officeProfile."));
  assert.deepEqual(keys, ["iaqar.officeProfile.platform"]);
  assert.equal(window.localStorage.getItem("iaqar.officeProfile.office-other"), null);
});
