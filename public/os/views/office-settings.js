/**
 * إعدادات المكتب — the same settings the old app offers, in the new design:
 *   #/settings           hub
 *   #/settings/profile   بيانات المكتب
 *   #/settings/link      رابط المكتب
 *   #/settings/cooperation   التعاون بين الوسطاء
 *   #/settings/brokers   الوسطاء والإسناد والصلاحيات (settings.js)
 * Manager-only; everything saves through core/office-profile.js.
 */

import { h, ic, clear, append } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { session } from "../core/session.js";
import { runAction, toast } from "../core/ui.js";
import { COOPERATION_OPTIONS, loadCooperationMode, photoToDataUrl, saveBrokerPhoto, officeNameIsFree, saveCooperationMode, saveOfficeProfile, savePublicSlug } from "../core/office-profile.js";
import { isSafePhotoDataUrl } from "../domain/avatar-domain.js";
import { loadChannelStatus } from "../core/channels.js";
import { automationLabel, channelViews } from "../domain/channels-domain.js";
import { OFFICE_NAME_MESSAGES, SPECIALTIES, buildOfficeProfile, checkPublicSlug } from "../domain/office-profile-domain.js";
import { officeShareUrl } from "../domain/share-card-domain.js";
import { ensureShareCard } from "../core/share-card.js";
import { workerBase } from "../core/runtime.js";

function pageHead(title, backTo = "settings") {
  return h("div", { class: "os-page-head" },
    h("button", { type: "button", class: "os-back", onClick: () => (backTo === "settings" ? go("settings") : back("tasks")) }, ic("chev-right"), "رجوع"),
    h("h1", { class: "os-page-title", text: title }), h("span"));
}

function managerOnly(container, title) {
  append(container, pageHead(title, "tasks"));
  if (session.isManager) return false;
  append(container, h("div", { class: "os-alert warn", text: "هذه الإعدادات لمدير المكتب فقط." }));
  return true;
}

function row(icon, title, hint, route) {
  return h("button", { type: "button", class: "os-set-row", "data-settings": route, onClick: () => go(`settings/${route}`) },
    h("span", { class: "os-set-icon" }, ic(icon)),
    h("span", { class: "os-set-text" }, h("b", { text: title }), h("small", { text: hint })),
    ic("chev-left"));
}

export function renderSettingsHub(container) {
  if (managerOnly(container, "إعدادات المكتب")) return null;
  const office = session.office || {};
  append(container,
    h("section", { class: "os-card os-set-list", "aria-label": "إعدادات المكتب" },
      row("office", "بيانات المكتب", [office.officeName, office.city].filter(Boolean).join(" · ") || "الاسم والرخصة والجوال والتخصص", "profile"),
      row("link", "رابط المكتب", office.publicSlug ? `/m/${office.publicSlug}` : "الرابط القصير لعملائك ومالكي العقارات", "link"),
      row("handshake", "التعاون بين الوسطاء", "هل تستقبل طلبات تعاون من مكاتب أخرى؟", "cooperation"),
      row("send", "قنوات المكتب", "واتساب وتيليجرام — حالة الاتصال واستقبال الرسائل", "channels"),
      row("broker", "الوسطاء والإسناد والصلاحيات", "من يستلم ما يصل من رابط المكتب، ومن يُتمّ الصفقات", "brokers")));
  return null;
}

function field(label, control, error) {
  return h("label", { class: "os-field" }, h("span", { text: label }), control, error);
}

/** صورة الوسيط: choose → preview → save, or remove. Falls back to the default mark when there is none. */
function photoCard() {
  let pending = null;
  const current = () => (isSafePhotoDataUrl(session.office?.brokerPhotoUrl) ? session.office.brokerPhotoUrl : "");
  const preview = h("div", { class: "os-avatar-preview", "data-photo-preview": "" });
  const message = h("small", { class: "os-field-error", "data-error": "photo", role: "alert" });
  const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", class: "os-file-hidden", "data-photo-input": "", "aria-label": "اختيار صورة الوسيط" });
  const choose = h("button", { type: "button", class: "os-btn secondary", "data-photo-choose": "" }, ic("edit"), "اختيار صورة");
  const save = h("button", { type: "button", class: "os-btn primary", "data-photo-save": "" }, ic("check"), "حفظ الصورة");
  const remove = h("button", { type: "button", class: "os-btn ghost", "data-photo-remove": "" }, ic("trash"), "حذف الصورة");
  const draw = () => {
    clear(preview);
    const src = pending || current();
    if (src) {
      const img = h("img", { src, alt: "صورة الوسيط", "data-photo-img": "" });
      img.addEventListener("error", () => { img.remove(); preview.append(h("span", { class: "ref-office-logo-mark", "aria-hidden": "true" })); });
      preview.append(img);
    } else preview.append(h("span", { class: "ref-office-logo-mark", "aria-hidden": "true" }));
    save.hidden = !pending;
    remove.hidden = Boolean(pending) || !current();
    choose.lastChild.textContent = current() || pending ? "تغيير الصورة" : "اختيار صورة";
  };
  choose.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    message.textContent = "";
    const chosen = file.files?.[0];
    file.value = "";
    if (!chosen) return;
    try { pending = await photoToDataUrl(chosen); } catch (error) { pending = null; message.textContent = error.message; }
    draw();
  });
  save.addEventListener("click", () => runAction(save, async () => { await saveBrokerPhoto(pending); pending = null; draw(); }, { success: "تم حفظ الصورة" }));
  remove.addEventListener("click", () => runAction(remove, async () => { await saveBrokerPhoto(""); draw(); }, { success: "تم حذف الصورة" }));
  draw();
  return h("section", { class: "os-card os-photo-card", "data-photo-card": "" },
    preview,
    h("div", { class: "os-photo-copy" },
      h("b", { text: "صورة الوسيط" }),
      h("small", { text: "تظهر في بطاقة المكتب. بدونها تبقى الصورة الافتراضية." }),
      h("div", { class: "os-btn-row" }, choose, save, remove),
      message, file));
}

export function renderOfficeProfile(container) {
  if (managerOnly(container, "بيانات المكتب")) return null;
  const office = session.office || {};
  const input = (name, value, extra = {}) => { const el = h("input", { class: "os-input", name, maxlength: extra.maxlength || "80", ...extra }); el.value = value || ""; return el; };
  const err = (key) => h("small", { class: "os-field-error", "data-error": key, role: "alert" });
  const nameInput = input("officeName", office.officeName, { dir: "auto", autocomplete: "off" });
  const brokerInput = input("brokerName", office.brokerName);
  const licenseInput = input("licenseNumber", office.licenseNumber, { inputmode: "numeric", maxlength: "20", dir: "ltr" });
  const cityInput = input("city", office.city, { maxlength: "60" });
  const phoneInput = input("phone", office.phone, { inputmode: "tel", maxlength: "20", dir: "ltr", placeholder: "05XXXXXXXX" });
  const errors = Object.fromEntries(["officeName", "brokerName", "licenseNumber", "city", "phone"].map((k) => [k, err(k)]));
  const availability = h("small", { class: "os-field-note", "data-name-availability": "", role: "status" });
  const chosen = new Set(Array.isArray(office.specialties) ? office.specialties : []);
  const specialties = h("div", { class: "os-seg os-specialties", role: "group", "aria-label": "تخصص المكتب" }, SPECIALTIES.map((s) => {
    const b = h("button", { type: "button", "aria-pressed": String(chosen.has(s.value)), "data-specialty": s.value, text: s.label });
    b.addEventListener("click", () => { if (chosen.has(s.value)) chosen.delete(s.value); else chosen.add(s.value); b.setAttribute("aria-pressed", String(chosen.has(s.value))); });
    return b;
  }));
  let check = 0;
  nameInput.addEventListener("input", async () => {
    const mine = ++check;
    const built = buildOfficeProfile({ officeName: nameInput.value, brokerName: "x", licenseNumber: "1", city: "x" });
    errors.officeName.textContent = built.errors.officeName || "";
    availability.textContent = "";
    if (built.errors.officeName || built.data.officeNameKey === office.officeNameKey) return;
    availability.textContent = "جارٍ التحقق من توفر الاسم…";
    try {
      const free = await officeNameIsFree(built.data.officeNameKey);
      if (mine !== check) return;
      availability.textContent = free ? OFFICE_NAME_MESSAGES.available : "";
      errors.officeName.textContent = free ? "" : OFFICE_NAME_MESSAGES.taken;
    } catch (_) { if (mine === check) availability.textContent = ""; }
  });
  const save = h("button", { type: "submit", class: "os-btn primary block" }, ic("check"), "حفظ بيانات المكتب");
  const form = h("form", { class: "os-form os-card", novalidate: true },
    field("اسم المكتب", nameInput, errors.officeName), availability,
    field("اسم الوسيط", brokerInput, errors.brokerName),
    field("رقم رخصة فال", licenseInput, errors.licenseNumber),
    field("المدينة", cityInput, errors.city),
    field("رقم الجوال", phoneInput, errors.phone),
    h("div", { class: "os-field" }, h("span", { text: "تخصص المكتب (اختياري)" }), specialties),
    save);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const built = buildOfficeProfile({
      officeName: nameInput.value, brokerName: brokerInput.value, licenseNumber: licenseInput.value, city: cityInput.value,
      phone: phoneInput.value, specialties: [...chosen]
    }, { isPlatformAdmin: false });
    for (const key of Object.keys(errors)) errors[key].textContent = built.errors[key] || "";
    if (!built.ok) { toast("راجع الحقول المطلوبة", "bad"); return; }
    await runAction(save, async () => {
      await saveOfficeProfile(built.data);
      availability.textContent = "";
    }, { success: "تم حفظ بيانات المكتب", onError: (error) => { if (/مستخدم أو محجوز/.test(error.message)) errors.officeName.textContent = error.message; } });
  });
  append(container, photoCard(), form);
  return null;
}

export function renderLinkSettings(container) {
  if (managerOnly(container, "رابط المكتب")) return null;
  const linkOf = () => officeShareUrl({ slug: session.office?.publicSlug, officeId: session.officeId, origin: location.origin, hostname: location.hostname, workerOrigin: workerBase() });
  const linkBox = h("input", { class: "os-input", readonly: true, dir: "ltr", "data-office-link": "" });
  const slug = h("input", { class: "os-input", name: "publicSlug", dir: "ltr", maxlength: "20", autocomplete: "off", placeholder: "wadi" });
  slug.value = session.office?.publicSlug || "";
  const hint = h("small", { class: "os-field-note", "data-slug-hint": "", role: "status", text: "أحرف إنجليزية صغيرة وأرقام وشرطة، من 3 إلى 20." });
  const sync = () => { linkBox.value = linkOf(); };
  sync();
  const cardImg = h("img", { class: "os-share-card-img", alt: "بطاقة معاينة الرابط", "data-share-card-preview": "", hidden: true });
  const cardStatus = h("small", { class: "os-field-note", "data-share-card-status": "", role: "status", text: "جارٍ تجهيز بطاقة المعاينة…" });
  const refreshCard = h("button", { type: "button", class: "os-btn secondary block", "data-share-card-refresh": "" }, ic("refresh"), "تحديث بطاقة المعاينة");
  const showCard = (result) => {
    if (result.blob) { if (cardImg.src.startsWith("blob:")) URL.revokeObjectURL(cardImg.src); cardImg.src = URL.createObjectURL(result.blob); cardImg.hidden = false; }
    cardStatus.classList.toggle("is-error", result.status === "failed");
    cardStatus.textContent = result.status === "failed" ? `لم تُحدَّث بطاقة المعاينة: ${result.reason}` : result.status === "uploaded" ? "تم تحديث بطاقة المعاينة — ستظهر في واتساب عند مشاركة الرابط." : "بطاقة المعاينة محدّثة.";
    sync(); refreshShare();
  };
  refreshCard.addEventListener("click", () => runAction(refreshCard, async () => showCard(await ensureShareCard({ force: true }))));
  ensureShareCard().then(showCard);
  slug.addEventListener("input", () => {
    const checked = checkPublicSlug(slug.value);
    hint.textContent = !slug.value ? "أحرف إنجليزية صغيرة وأرقام وشرطة، من 3 إلى 20." : checked.ok ? `الرابط: /m/${checked.slug}` : checked.message;
    hint.classList.toggle("is-error", Boolean(slug.value) && !checked.ok);
  });
  const copy = h("button", { type: "button", class: "os-btn primary", "data-copy-link": "" }, ic("link"), "نسخ الرابط");
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(linkBox.value); toast("تم نسخ رابط المكتب", "ok"); } catch (_) { linkBox.select(); toast("حدّد الرابط وانسخه يدويًا"); }
  });
  const share = h("a", { class: "os-btn secondary", target: "_blank", rel: "noopener noreferrer", "data-share-link": "" }, ic("whatsapp"), "مشاركة عبر واتساب");
  const refreshShare = () => { share.href = `https://wa.me/?text=${encodeURIComponent(`رابط ${session.office?.officeName || "المكتب"} لتسجيل العروض والطلبات:\n${linkBox.value}`)}`; };
  refreshShare();
  const save = h("button", { type: "button", class: "os-btn secondary block" }, ic("check"), "حفظ معرّف الرابط");
  save.addEventListener("click", () => runAction(save, async () => {
    await savePublicSlug(slug.value);
    slug.value = session.office.publicSlug;
    sync(); refreshShare();
  }, { success: "تم حفظ معرّف الرابط" }));
  append(container,
    h("section", { class: "os-card" },
      h("h2", { class: "os-h2" }, ic("link"), "رابط المكتب"),
      h("p", { class: "os-sub", text: "شاركه مع عملائك ومالكي العقارات ليسجّلوا بياناتهم لمكتبك دون حساب." }),
      linkBox, h("div", { class: "os-btn-row" }, copy, share)),
    h("section", { class: "os-card os-form" },
      field("معرّف الرابط القصير", slug, hint), save),
    h("section", { class: "os-card os-share-card" },
      h("h2", { class: "os-h2" }, ic("shield"), "بطاقة معاينة الرابط"),
      h("p", { class: "os-sub", text: "هذه الصورة تظهر في واتساب عند مشاركة رابط المكتب: صورة الوسيط وبيانات المكتب ورقم الرخصة." }),
      cardImg, cardStatus, refreshCard));
  return null;
}

export function renderCooperationSettings(container) {
  if (managerOnly(container, "التعاون بين الوسطاء")) return null;
  const body = h("div", {}, h("div", { class: "os-skeleton" }));
  append(container, body);
  let selected = "";
  loadCooperationMode().then((mode) => {
    selected = mode;
    clear(body);
    const group = h("div", { class: "os-radio-list", role: "radiogroup", "aria-label": "وضع التعاون" });
    const draw = () => {
      clear(group);
      for (const option of COOPERATION_OPTIONS) {
        const on = option.value === selected;
        const b = h("button", { type: "button", class: `os-radio${on ? " on" : ""}`, role: "radio", "aria-checked": String(on), "data-mode": option.value },
          h("span", { class: "os-radio-dot", "aria-hidden": "true" }),
          h("span", { class: "os-set-text" }, h("b", { text: option.label }), h("small", { text: option.help })));
        b.addEventListener("click", () => { selected = option.value; draw(); });
        group.append(b);
      }
    };
    draw();
    const save = h("button", { type: "button", class: "os-btn primary block" }, ic("check"), "حفظ إعداد التعاون");
    save.addEventListener("click", () => runAction(save, () => saveCooperationMode(selected), { success: "تم حفظ إعداد التعاون" }));
    append(body,
      h("section", { class: "os-card" },
        h("h2", { class: "os-h2" }, ic("handshake"), "التعاون بين الوسطاء"),
        h("p", { class: "os-sub", text: "بيانات التواصل لا تظهر تلقائيًا في أي وضع." }),
        group),
      save);
  }).catch(() => { clear(body); append(body, h("div", { class: "os-alert bad", text: "تعذر تحميل إعداد التعاون." })); });
  return null;
}

export function renderChannelSettings(container) {
  if (managerOnly(container, "قنوات المكتب")) return null;
  const body = h("div", {}, h("div", { class: "os-skeleton" }));
  append(container, body);
  loadChannelStatus(session.officeId).then((payload) => {
    clear(body);
    const cards = channelViews(payload).map((view) => h("article", { class: "os-card os-chan-card", "data-channel": view.id },
      h("span", { class: "os-set-icon" }, ic(view.icon)),
      h("div", { class: "os-set-text" },
        h("b", { text: view.name }),
        h("small", { text: view.hint }),
        view.detail ? h("small", { text: view.detail, dir: "auto" }) : null),
      h("span", { class: `os-chan-status is-${view.status}`, "data-channel-status": view.status, text: view.statusLabel })));
    append(body,
      h("p", { class: "os-sub", text: "القنوات وسيلة نقل فقط: تصل الرسائل إلى صندوق المكتب ثم تُعالج كأي عميل أو عرض أو طلب." }),
      ...cards,
      h("section", { class: "os-card os-set-legacy" },
        h("h2", { class: "os-h2" }, ic("shield"), "الأتمتة"),
        h("p", { class: "os-sub", "data-automation": payload.automationMode || "ASSISTED", text: `الوضع الحالي: ${automationLabel(payload)}. الإرسال التلقائي للعملاء غير مفعّل.` }),
        h("p", { class: "os-sub", "data-channels-setup": "", text: "ربط واتساب وتيليجرام يتم حاليًا بإعداد من إدارة المنصة. بعد الربط تظهر الحالة هنا." })));
  }).catch(() => { clear(body); append(body, h("div", { class: "os-alert bad", text: "تعذر تحميل حالة القنوات." })); });
  return null;
}
