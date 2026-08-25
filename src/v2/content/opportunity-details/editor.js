import {
  ADVERTISER_ROLES,
  advertiserRoleLabel,
  isPersistedAdvertiserRole,
  resolveAdvertiserEnumValue
} from "../../advertiser-phone-domain.js";
import { escapeContentHtml } from "../domain.js";

const EDITOR_SESSION = "__iaqarEditorSession";
const CANONICAL_ROLES = ADVERTISER_ROLES.filter((row) => row.id !== "UNKNOWN");
const ROLE_PLACEHOLDER = "اختر أو اكتب صفة المعلن";

function editorAdvertiserRoleValue(vm = {}, seed = "") {
  const resolved = resolveAdvertiserEnumValue(seed) || resolveAdvertiserEnumValue(vm.advertiserRole);
  if (!isPersistedAdvertiserRole(resolved)) return "";
  return advertiserRoleLabel(resolved);
}

function roleChipsHtml(selectedLabel = "") {
  return `<div class="cv2-role-chips" role="list">
    ${CANONICAL_ROLES.map((row) => {
      const selected = selectedLabel === row.label ? " is-selected" : "";
      return `<button type="button" class="cv2-role-chip${selected}" role="listitem" data-cv2-role="${escapeContentHtml(row.label)}">${escapeContentHtml(row.label)}</button>`;
    }).join("")}
  </div>`;
}

export function buildFieldEditorV2(editorKey, vm = {}, seed = "") {
  const roleValue = editorAdvertiserRoleValue(vm, seed);
  const editors = {
    advertiserRole: {
      title: "صفة المعلن",
      hint: "مالك، عميل، مفوض، وسيط عقاري",
      input: `<input class="cv2-editor-input" name="advertiserRole" type="text" maxlength="40" autocomplete="off" value="${escapeContentHtml(roleValue)}" placeholder="${escapeContentHtml(ROLE_PLACEHOLDER)}">`
    },
    contactNumber: {
      title: "رقم التواصل",
      hint: "05XXXXXXXX",
      input: `<input class="cv2-editor-input" name="contactNumber" type="tel" inputmode="numeric" maxlength="14" autocomplete="off" value="${escapeContentHtml(seed || vm.contactNumber || "")}" placeholder="05XXXXXXXX">`
    },
    price: {
      title: vm.priceLabel || "السعر",
      hint: "أدخل الرقم فقط",
      input: `<input class="cv2-editor-input" name="price" type="number" inputmode="numeric" autocomplete="off" value="${escapeContentHtml(seed)}" placeholder="مثال: 850000">`
    },
    area: {
      title: "المساحة",
      hint: "بالمتر المربع",
      input: `<input class="cv2-editor-input" name="area" type="number" inputmode="numeric" autocomplete="off" value="${escapeContentHtml(String(vm.area || "").replace(/[^\d.]/g, ""))}" placeholder="0">`
    },
    location: {
      title: "الموقع",
      hint: "المدينة والحي",
      input: `<input class="cv2-editor-input" name="city" type="text" maxlength="80" autocomplete="off" value="${escapeContentHtml(vm.cityValue || vm.city || seed)}" placeholder="المدينة">
        <input class="cv2-editor-input" name="district" type="text" maxlength="80" autocomplete="off" value="${escapeContentHtml(vm.districtValue || vm.district || "")}" placeholder="الحي">`
    },
    propertyPurpose: {
      title: "العقار والغرض",
      hint: "مثال: أرض — بيع",
      input: `<input class="cv2-editor-input" name="propertyType" type="text" maxlength="80" autocomplete="off" value="${escapeContentHtml(vm.propertyPurpose || "")}" placeholder="نوع العقار">
        <input class="cv2-editor-input" name="purpose" type="text" maxlength="40" autocomplete="off" placeholder="بيع / إيجار">`
    }
  };
  const spec = editors[editorKey] || editors.advertiserRole;
  const roleHints = editorKey === "advertiserRole" ? roleChipsHtml(roleValue) : "";
  const isContact = editorKey === "contactNumber";
  const saveLabel = isContact ? "حفظ الرقم" : "حفظ";
  const contactAction = isContact
    ? `<button type="button" class="cv2-editor-contact-save" id="cv2EditorContactSave" data-cv2-save-device-contact>
          <svg class="cv2-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.5h8a2 2 0 0 1 2 2v13l-6-3.2-6 3.2v-13a2 2 0 0 1 2-2z"/><path d="M10 9h4M10 12h4"/></svg>
          <span>حفظ في جهات الاتصال</span>
        </button>`
    : "";
  return `<div class="cv2-editor" id="cv2Editor" data-cv2-editor-root data-cv2-editor="${escapeContentHtml(editorKey)}" role="dialog" aria-modal="true" aria-labelledby="cv2EditorTitle">
    <div class="cv2-editor-sheet">
      <h3 id="cv2EditorTitle">${escapeContentHtml(spec.title)}</h3>
      <p class="cv2-editor-hint">${escapeContentHtml(spec.hint)}</p>
      ${roleHints}
      <form id="cv2EditorForm" class="cv2-editor-form" autocomplete="off">
        ${spec.input}
        <p class="cv2-editor-error" id="cv2EditorError" hidden></p>
        <p class="cv2-editor-contact-status" id="cv2ContactSaveStatus" hidden></p>
        <div class="cv2-editor-actions${isContact ? " is-contact" : ""}">
          <button type="submit" class="cv2-editor-save" id="cv2EditorSave">${saveLabel}</button>
          ${contactAction}
          <button type="button" class="cv2-editor-cancel" id="cv2EditorCancel">إلغاء</button>
        </div>
      </form>
    </div>
  </div>`;
}

export function wireFieldEditorSheet(overlay, options = {}) {
  if (!overlay) return () => {};
  const sheet = overlay.querySelector(".cv2-editor-sheet") || overlay.querySelector(".opp-v2-editor-sheet");
  const opener = options.opener;
  let closed = false;
  let ignorePop = false;
  let historyPushed = false;

  const cleanup = () => {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("popstate", onPop);
  };

  const close = ({ restoreFocus = true, popHistory = true } = {}) => {
    if (closed) return;
    closed = true;
    cleanup();
    const active = overlay.querySelector("input, textarea, select");
    if (active && typeof active.blur === "function") active.blur();
    overlay.remove();
    if (historyPushed && popHistory) {
      ignorePop = true;
      historyPushed = false;
      try { history.back(); } catch (_) { /* ignore */ }
    }
    if (restoreFocus && opener && typeof opener.focus === "function" && document.contains(opener)) {
      try { opener.focus({ preventScroll: true }); } catch (_) { opener.focus(); }
    }
  };

  const onKey = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  const onPop = () => {
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    historyPushed = false;
    close({ popHistory: false });
  };

  overlay.addEventListener("click", (event) => {
    if (!sheet || !sheet.contains(event.target)) close();
  });
  sheet?.addEventListener("click", (event) => event.stopPropagation());
  overlay.querySelector("#cv2EditorCancel")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  overlay.querySelector("#oppV2EditorCancel")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  overlay.querySelectorAll("[data-cv2-role]").forEach((chip) => {
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const input = overlay.querySelector('input[name="advertiserRole"]');
      const label = chip.getAttribute("data-cv2-role") || "";
      if (!input) return;
      input.value = label;
      overlay.querySelectorAll("[data-cv2-role]").forEach((node) => {
        node.classList.toggle("is-selected", node === chip);
      });
    });
  });

  document.addEventListener("keydown", onKey, true);
  try {
    history.pushState({ iaqarFieldEditor: 1 }, "", location.href);
    historyPushed = true;
    window.addEventListener("popstate", onPop);
  } catch (_) { /* ignore */ }

  overlay[EDITOR_SESSION] = { close };
  return close;
}

export function dismissFieldEditor(overlay, options = {}) {
  const session = overlay?.[EDITOR_SESSION];
  if (session && typeof session.close === "function") {
    session.close(options);
    return;
  }
  overlay?.remove();
}
