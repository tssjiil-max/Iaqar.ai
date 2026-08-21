/**
 * Save the opportunity phone number into the device address book via vCard.
 * Does not claim the OS actually stored the contact.
 */

import {
  SAVE_PHONE_CONTACT_LABEL,
  SAVE_PHONE_CONTACT_OPENED,
  SAVE_PHONE_CONTACT_PREPARING,
  buildPhoneContactVcard,
  phoneContactVcardFilename,
  validatePhoneContactSave
} from "./phone-contact-save-domain.js";

let saveInFlight = false;

function toast(message) {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  globalThis.clearTimeout(toast._timer);
  toast._timer = globalThis.setTimeout(() => node.classList.remove("show"), 2800);
}

function readSavePayloadFromButton(button) {
  const kind = String(button?.getAttribute("data-contact-kind") || "").trim().toLowerCase();
  return {
    phoneRaw: String(button?.getAttribute("data-contact-phone") || "").trim(),
    displayName: String(button?.getAttribute("data-contact-name") || "").trim(),
    roleLabel: String(button?.getAttribute("data-contact-role") || "").trim(),
    propertyType: String(button?.getAttribute("data-contact-property") || "").trim(),
    district: String(button?.getAttribute("data-contact-district") || "").trim(),
    city: String(button?.getAttribute("data-contact-city") || "").trim(),
    purpose: String(button?.getAttribute("data-contact-purpose") || "").trim(),
    personKind: kind,
    isOwner: kind === "owner"
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
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 2500);
  return { ok: true, method: "download" };
}

export async function savePhoneNumberToDevice(input = {}) {
  if (saveInFlight) return { ok: false, busy: true };
  const check = validatePhoneContactSave(input);
  if (!check.ok) return check;
  saveInFlight = true;
  try {
    const saved = await shareOrDownloadVcard({
      ...input,
      phoneRaw: check.phoneE164,
      displayName: check.displayName
    });
    if (!saved.ok) return saved;
    return { ...check, ...saved };
  } finally {
    saveInFlight = false;
  }
}

export function bindPhoneContactSave(root = document) {
  if (!root || root.__iaqarPhoneContactBound) return;
  root.__iaqarPhoneContactBound = true;
  root.addEventListener("click", (event) => {
    const button = event.target.closest(".js-save-phone-contact");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled || button.getAttribute("aria-busy") === "true" || saveInFlight) {
      return;
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    toast(SAVE_PHONE_CONTACT_PREPARING);
    void savePhoneNumberToDevice(readSavePayloadFromButton(button)).then((result) => {
      if (result.busy || result.cancelled) return;
      if (!result.ok) {
        toast(result.error || "تعذر تجهيز جهة الاتصال");
        return;
      }
      toast(SAVE_PHONE_CONTACT_OPENED);
    }).finally(() => {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    });
  }, true);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => bindPhoneContactSave(document));
} else {
  bindPhoneContactSave(document);
}
