/**
 * Save the opportunity phone number into the device address book via vCard.
 * Display name comes from opportunity data (name + role + district / property).
 */

import {
  SAVE_PHONE_CONTACT_LABEL,
  buildPhoneContactVcard,
  phoneContactVcardFilename,
  validatePhoneContactSave
} from "./phone-contact-save-domain.js";

function toast(message) {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => node.classList.remove("show"), 2800);
}

function readSavePayloadFromButton(button) {
  return {
    phoneRaw: String(button?.getAttribute("data-contact-phone") || "").trim(),
    displayName: String(button?.getAttribute("data-contact-name") || "").trim(),
    roleLabel: String(button?.getAttribute("data-contact-role") || "").trim(),
    propertyType: String(button?.getAttribute("data-contact-property") || "").trim(),
    district: String(button?.getAttribute("data-contact-district") || "").trim()
  };
}

async function shareOrDownloadVcard(payload) {
  const text = buildPhoneContactVcard(payload);
  if (!text) return { ok: false, error: "تعذر تجهيز جهة الاتصال" };
  const filename = phoneContactVcardFilename(payload);
  const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
  const file = typeof File === "function"
    ? new File([blob], filename, { type: "text/vcard;charset=utf-8" })
    : null;
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (file && nav?.share && typeof nav.canShare === "function") {
    try {
      if (nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: payload.displayName || SAVE_PHONE_CONTACT_LABEL
        });
        return { ok: true, method: "share" };
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        return { ok: false, cancelled: true };
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
  return { ok: true, method: "download" };
}

export async function savePhoneNumberToDevice(input = {}) {
  const check = validatePhoneContactSave(input);
  if (!check.ok) return check;
  const saved = await shareOrDownloadVcard({
    phoneRaw: check.phoneE164,
    displayName: check.displayName,
    roleLabel: input.roleLabel,
    propertyType: input.propertyType,
    district: input.district
  });
  if (!saved.ok) return saved;
  return { ...check, ...saved };
}

export function bindPhoneContactSave(root = document) {
  if (!root || root.__iaqarPhoneContactBound) return;
  root.__iaqarPhoneContactBound = true;
  root.addEventListener("click", (event) => {
    const button = event.target.closest(".js-save-phone-contact");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    void savePhoneNumberToDevice(readSavePayloadFromButton(button)).then((result) => {
      if (result.cancelled) return;
      if (!result.ok) {
        toast(result.error || "تعذر حفظ الرقم في سجل الهاتف");
        return;
      }
      toast(`تم حفظ «${result.displayName}» في سجل الهاتف`);
    });
  }, true);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => bindPhoneContactSave(document));
} else {
  bindPhoneContactSave(document);
}
