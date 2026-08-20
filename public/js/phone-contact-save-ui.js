/**
 * Save advertiser name + phone into the device contact book via vCard.
 */

import {
  SAVE_PHONE_CONTACT_LABEL,
  buildContactSavePatch,
  buildContactVcard,
  contactSaveFilename,
  validateContactSavePayload
} from "./phone-contact-save-domain.js";

function toast(message) {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => node.classList.remove("show"), 2800);
}

export function readContactSavePayloadFromButton(button) {
  const root = button?.closest(".opp-details-data-table") || button?.parentElement;
  const nameInput = root?.querySelector(".opp-contact-name-input");
  const phoneInput = root?.querySelector(".opp-contact-phone-input");
  return {
    opportunityId: String(button?.getAttribute("data-opportunity-id") || "").trim(),
    displayName: nameInput
      ? nameInput.value
      : String(button?.getAttribute("data-contact-name") || ""),
    phoneRaw: phoneInput
      ? phoneInput.value
      : String(button?.getAttribute("data-contact-phone") || ""),
    roleLabel: String(button?.getAttribute("data-contact-role") || "")
  };
}

async function shareOrDownloadVcard(payload) {
  const text = buildContactVcard(payload);
  if (!text) return { ok: false, error: "تعذر تجهيز جهة الاتصال" };
  const filename = contactSaveFilename(payload);
  const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
  const file = typeof File === "function"
    ? new File([blob], filename, { type: "text/vcard;charset=utf-8" })
    : null;

  if (file && navigator.share && typeof navigator.canShare === "function") {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: payload.displayName,
          text: `${payload.displayName} ${payload.phoneLocal}`
        });
        return { ok: true, method: "share" };
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        return { ok: false, cancelled: true, error: "cancelled" };
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

export async function savePhoneContactToDevice(input = {}) {
  const check = validateContactSavePayload(input);
  if (!check.ok) return check;
  const saved = await shareOrDownloadVcard(check);
  if (!saved.ok) return saved;
  return {
    ...check,
    ...saved,
    patch: buildContactSavePatch(input)
  };
}

async function handleSaveButton(button) {
  const raw = readContactSavePayloadFromButton(button);
  const result = await savePhoneContactToDevice(raw);
  if (result.cancelled) return;
  if (!result.ok) {
    toast(result.error || "تعذر حفظ الرقم في الجوال");
    return;
  }
  toast("تم حفظ الاسم مع الرقم في سجل الجوال");
  document.dispatchEvent(new CustomEvent("iaqar:phone-contact-save", {
    bubbles: true,
    detail: {
      opportunityId: raw.opportunityId,
      displayName: result.displayName,
      phoneE164: result.phoneE164,
      phoneLocal: result.phoneLocal,
      patch: result.patch,
      method: result.method
    }
  }));
}

export function bindPhoneContactSave(root = document) {
  if (!root || root.__iaqarPhoneContactBound) return;
  root.__iaqarPhoneContactBound = true;
  root.addEventListener("click", (event) => {
    const button = event.target.closest(".js-save-phone-contact");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    void handleSaveButton(button);
  }, true);
}

export { SAVE_PHONE_CONTACT_LABEL };
