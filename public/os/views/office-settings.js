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
import { confirmDialog, runAction, toast } from "../core/ui.js";
import { COOPERATION_OPTIONS, loadCooperationMode, photoToDataUrl, saveBrokerPhoto, officeNameIsFree, saveCooperationMode, saveOfficeProfile, savePublicSlug } from "../core/office-profile.js";
import { isSafePhotoDataUrl } from "../domain/avatar-domain.js";
import { connectWhatsapp, disconnectWhatsapp, loadChannels, startTelegramLink, unlinkTelegram } from "../core/channels.js";
import { automationLabel } from "../domain/channels-domain.js";
import { CHANNEL_REGISTRY } from "../domain/channel-link-domain.js";
import { OFFICE_NAME_MESSAGES, SPECIALTIES, buildOfficeProfile, checkPublicSlug } from "../domain/office-profile-domain.js";
import { officePermanentUrl, officeShareUrl } from "../domain/share-card-domain.js";
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
  return h("button", { type: "button", class: "os-set-row", "data-settings": route, onClick: () => go(route === "library" ? "library" : `settings/${route}`) },
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
      row("archive", "مكتبة المكتب", "عقود الوساطة والصفقات ومستندات المكتب", "library"),
      row("bell", "الإشعارات", "أنواع الإشعارات التي يستقبلها المكتب وحسابك", "notifications"),
      row("broker", "الوسطاء والإسناد والصلاحيات", "من يستلم ما يصل من رابط المكتب، ومن يُتمّ الصفقات", "brokers")));
  return null;
}

function field(label, control, error) {
  return h("label", { class: "os-field" }, h("span", { text: label }), control, error);
}

/** شعار المكتب أو صورة الوسيط: choose → preview → save, or remove. The whole image is kept (no crop). Falls back to the default mark when there is none. */
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
  save.addEventListener("click", () => runAction(save, async () => { await saveBrokerPhoto(pending); pending = null; draw(); ensureShareCard(); }, { success: "تم حفظ الصورة" }));
  remove.addEventListener("click", () => runAction(remove, async () => { await saveBrokerPhoto(""); draw(); ensureShareCard(); }, { success: "تم حذف الصورة" }));
  draw();
  return h("section", { class: "os-card os-photo-card", "data-photo-card": "" },
    preview,
    h("div", { class: "os-photo-copy" },
      h("b", { text: "شعار المكتب أو صورة الوسيط" }),
      h("small", { text: "تظهر كاملة في بطاقة المكتب دون قص. بدونها يبقى الشعار الافتراضي." }),
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

  const permanentLinkOf = () => officePermanentUrl({
    slug: session.office?.publicSlug,
    officeId: session.officeId,
    origin: location.origin
  });
  const shareLinkOf = () => officeShareUrl({
    slug: session.office?.publicSlug,
    officeId: session.officeId,
    origin: location.origin,
    hostname: location.hostname,
    workerOrigin: workerBase(),
    preview: session.office?.sharePreviewFormat === "immutable-v2" ? session.office?.shareCardNonce : ""
  });

  const linkBox = h("input", { class: "os-input", readonly: true, dir: "ltr", "data-office-link": "" });
  const slug = h("input", { class: "os-input", name: "publicSlug", dir: "ltr", maxlength: "20", autocomplete: "off", placeholder: "wadi" });
  slug.value = session.office?.publicSlug || "";
  const hint = h("small", { class: "os-field-note", "data-slug-hint": "", role: "status", text: "أحرف إنجليزية صغيرة وأرقام وشرطة، من 3 إلى 20." });
  const sync = () => { linkBox.value = permanentLinkOf(); };
  sync();

  const cardImg = h("img", { class: "os-share-card-img", alt: "صورة معاينة الرابط", "data-share-card-preview": "", hidden: true });
  const cardStatus = h("small", { class: "os-field-note", "data-share-card-status": "", role: "status", text: "جارٍ تجهيز بطاقة المعاينة…" });
  const refreshCard = h("button", { type: "button", class: "os-btn secondary block", "data-share-card-refresh": "" }, ic("refresh"), "تحديث صورة المعاينة");

  const copy = h("button", { type: "button", class: "os-btn primary", "data-copy-link": "" }, ic("link"), "نسخ رابط المشاركة");
  copy.addEventListener("click", async () => {
    const value = shareLinkOf();
    try { await navigator.clipboard.writeText(value); toast("تم نسخ رابط المشاركة", "ok"); }
    catch (_) { linkBox.select(); toast("تعذر النسخ التلقائي؛ رابط المكتب الدائم ظاهر أعلاه"); }
  });

  const share = h("a", { class: "os-btn secondary", target: "_blank", rel: "noopener noreferrer", "data-share-link": "" }, ic("whatsapp"), "مشاركة عبر واتساب");
  const refreshShare = () => {
    const previewLink = shareLinkOf();
    share.href = `https://wa.me/?text=${encodeURIComponent(`رابط ${session.office?.officeName || "المكتب"} لتسجيل العروض والطلبات:\n${previewLink}`)}`;
    share.dataset.previewUrl = previewLink;
  };

  const showCard = (result) => {
    if (result.blob) {
      if (cardImg.src.startsWith("blob:")) URL.revokeObjectURL(cardImg.src);
      cardImg.src = URL.createObjectURL(result.blob);
      cardImg.hidden = false;
    } else cardImg.hidden = true;
    if (result.previewVersion) session.office.shareCardNonce = result.previewVersion;
    cardStatus.classList.toggle("is-error", result.status === "failed");
    cardStatus.textContent = result.status === "failed" ? `لم تُحدَّث صورة المعاينة: ${result.reason}`
      : result.status === "uploaded" ? "تم إنشاء نسخة مشاركة جديدة — ستُستخدم تلقائيًا في واتساب."
      : "صورة المعاينة محدّثة.";
    sync();
    refreshShare();
  };

  refreshCard.addEventListener("click", () => runAction(refreshCard, async () => showCard(await ensureShareCard({ force: true }))));
  ensureShareCard().then(showCard);
  refreshShare();

  slug.addEventListener("input", () => {
    const checked = checkPublicSlug(slug.value);
    hint.textContent = !slug.value ? "أحرف إنجليزية صغيرة وأرقام وشرطة، من 3 إلى 20." : checked.ok ? `الرابط: /m/${checked.slug}` : checked.message;
    hint.classList.toggle("is-error", Boolean(slug.value) && !checked.ok);
  });

  const save = h("button", { type: "button", class: "os-btn secondary block" }, ic("check"), "حفظ معرّف الرابط");
  save.addEventListener("click", () => runAction(save, async () => {
    await savePublicSlug(slug.value);
    slug.value = session.office.publicSlug;
    const result = await ensureShareCard({ force: true });
    showCard(result);
  }, { success: "تم حفظ معرّف الرابط" }));

  append(container,
    h("section", { class: "os-card" },
      h("h2", { class: "os-h2" }, ic("link"), "رابط المكتب"),
      h("p", { class: "os-sub", text: "الرابط الظاهر أدناه هو رابط المكتب الدائم. أزرار النسخ وواتساب تستخدم نسخة مشاركة محدثة تلقائيًا لمنع عرض صورة قديمة." }),
      linkBox, h("div", { class: "os-btn-row" }, copy, share)),
    h("section", { class: "os-card os-form" },
      field("معرّف الرابط القصير", slug, hint), save),
    h("section", { class: "os-card os-share-card" },
      h("h2", { class: "os-h2" }, ic("shield"), "صورة معاينة الرابط"),
      h("p", { class: "os-sub", text: "كل تحديث ينشئ صفحة مشاركة وصورة جديدة؛ رابط المكتب الدائم لا يتغير." }),
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

function fact(label, value, attrs = {}) {
  return h("div", { class: "os-chan-fact", ...attrs }, h("dt", { text: label }), h("dd", { text: value, dir: "auto" }));
}

function channelHead(meta, view) {
  return h("header", { class: "os-chan-head" },
    h("span", { class: "os-set-icon" }, ic(meta.icon)),
    h("div", { class: "os-set-text" }, h("b", { text: meta.name }), h("small", { text: meta.hint })),
    h("span", { class: `os-chan-status is-${view.state.toLowerCase()}`, "data-channel-status": view.state, text: view.stateLabel }));
}

function channelAction(id, label, { kind = "secondary", icon = "link", run }) {
  const button = h("button", { type: "button", class: `os-btn ${kind}`, "data-channel-action": id }, ic(icon), label);
  button.addEventListener("click", () => run(button));
  return button;
}

function whatsappCard(view, reload) {
  const meta = CHANNEL_REGISTRY.whatsapp;
  const coexistence = view.onboardingMode !== "standard";
  const link = async (button) => {
    const yes = await confirmDialog({
      title: "ربط واتساب للأعمال",
      text: coexistence
        ? "ستفتح نافذة Meta الرسمية. سجّل الدخول هناك واختر ربط «تطبيق واتساب للأعمال» الحالي، ثم امسح الرمز من جوالك. يبقى رقمك وتطبيقك كما هما — لا يُنقل الرقم ولا يُحذف التطبيق."
        : "ستفتح نافذة Meta الرسمية لإكمال الربط. سجّل الدخول ووافق هناك.",
      confirmLabel: "فتح نافذة Meta"
    });
    if (!yes) return;
    await runAction(button, async () => { await connectWhatsapp(session.officeId); await reload(); }, { success: "تم ربط واتساب للأعمال بالمكتب" });
  };
  const unlink = async (button) => {
    const yes = await confirmDialog({
      title: "فصل واتساب عن المكتب؟",
      text: "يتوقف وصول رسائل هذا الرقم إلى مكتبك في النظام. رقمك وتطبيق واتساب للأعمال لا يتأثران، ويمكنك إعادة الربط في أي وقت.",
      confirmLabel: "فصل", danger: true
    });
    if (!yes) return;
    await runAction(button, async () => { await disconnectWhatsapp(session.officeId); await reload(); }, { success: "تم فصل واتساب عن المكتب" });
  };
  const actions = view.actions.map((action) => action === "disconnect"
    ? channelAction("disconnect", "فصل", { kind: "danger", icon: "x", run: unlink })
    : channelAction(action, action === "connect" ? "ربط واتساب للأعمال" : "إعادة الربط", { kind: action === "connect" ? "primary" : "secondary", icon: "link", run: link }));
  return h("article", { class: "os-card os-chan", "data-channel": "whatsapp" },
    channelHead(meta, view),
    h("dl", { class: "os-chan-facts" },
      fact("الرقم", view.number || "—", { "data-channel-number": "" }),
      fact("استقبال الرسائل (Webhook)", view.webhookLabel, { "data-webhook-status": view.webhookReady ? "ready" : "off" }),
      view.state === "CONNECTED" ? fact("رسائل اليوم", String(view.inboundToday)) : null,
      fact("طريقة الربط", coexistence ? "Cloud API مع بقاء الرقم على تطبيق واتساب للأعمال" : "Cloud API", { "data-onboarding": view.onboardingMode })),
    view.detail ? h("div", { class: "os-alert bad", "data-channel-error": "", text: view.detail }) : null,
    view.note ? h("p", { class: "os-sub", "data-channel-note": "", text: view.note }) : null,
    actions.length ? h("div", { class: "os-btn-row" }, ...actions) : null);
}

function telegramCard(view, reload, pending) {
  const meta = CHANNEL_REGISTRY.telegram;
  const link = (button) => runAction(button, async () => {
    const result = await startTelegramLink(session.officeId);
    if (result.state === "NOT_CONFIGURED" || !result.deepLink) throw new Error(result.message || "بوت المنصة غير مفعّل على هذه البيئة بعد");
    pending.link = result.deepLink;
    pending.expiresAt = result.expiresAt;
    await reload();
  });
  const unlink = async (button) => {
    const yes = await confirmDialog({
      title: view.state === "CONNECTED" ? "فصل تيليجرام عن المكتب؟" : "إلغاء رابط الربط؟",
      text: view.state === "CONNECTED" ? "يتوقف وصول رسائل هذه المحادثة إلى مكتبك. يمكنك إعادة الربط في أي وقت." : "يتوقف رابط الربط الحالي عن العمل.",
      confirmLabel: view.state === "CONNECTED" ? "فصل" : "إلغاء الرابط", danger: true
    });
    if (!yes) return;
    pending.link = "";
    await runAction(button, async () => { await unlinkTelegram(session.officeId); await reload(); }, { success: view.state === "CONNECTED" ? "تم فصل تيليجرام" : "أُلغي رابط الربط" });
  };
  const actions = view.actions.map((action) => action === "disconnect"
    ? channelAction("disconnect", view.state === "CONNECTED" ? "فصل" : "إلغاء الرابط", { kind: "danger", icon: "x", run: unlink })
    : channelAction(action, action === "connect" ? "ربط تيليجرام" : view.state === "PENDING" ? "رابط جديد" : "إعادة الربط", { kind: action === "connect" ? "primary" : "secondary", icon: "link", run: link }));
  // The one-time link stays on screen until it is used, cancelled or expired — also while the current chat is still linked.
  const showLink = Boolean(pending.link) && view.linkWaiting === true;
  const copy = h("button", { type: "button", class: "os-btn secondary", "data-telegram-copy": "" }, ic("clipboard"), "نسخ الرابط");
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(pending.link); toast("تم نسخ رابط الربط"); } catch (_) { toast("تعذر النسخ — افتح الرابط مباشرة", "bad"); }
  });
  return h("article", { class: "os-card os-chan", "data-channel": "telegram" },
    channelHead(meta, view),
    h("dl", { class: "os-chan-facts" },
      fact("البوت", view.botUsername ? `@${view.botUsername}` : "—"),
      view.detail ? fact(view.state === "CONNECTED" ? "المحادثة المرتبطة" : "ملاحظة", view.detail, { "data-channel-detail": "" }) : null),
    showLink ? h("div", { class: "os-chan-link", "data-telegram-pending": "" },
      h("p", { class: "os-sub", text: "افتح الرابط من حساب تيليجرام الذي تستقبل عليه رسائل المكتب ثم اضغط «ابدأ». الرابط صالح 15 دقيقة ولمرة واحدة." }),
      h("div", { class: "os-btn-row" },
        h("a", { class: "os-btn primary", href: pending.link, target: "_blank", rel: "noopener", "data-telegram-open": "" }, ic("send"), "فتح تيليجرام"),
        copy)) : null,
    view.linkWaiting && !pending.link ? h("p", { class: "os-sub", "data-telegram-pending": "", text: "رابط ربط سابق ما زال بانتظار الإتمام. أنشئ رابطًا جديدًا إن لم يعد لديك." }) : null,
    view.note ? h("p", { class: "os-sub", "data-channel-note": "", text: view.note }) : null,
    actions.length ? h("div", { class: "os-btn-row" }, ...actions) : null);
}

export function renderChannelSettings(container) {
  if (managerOnly(container, "قنوات المكتب")) return null;
  const body = h("div", { "data-channels": "" }, h("div", { class: "os-skeleton" }));
  append(container, body);
  // The one-time Telegram link lives only in this screen's memory; the server keeps its hash.
  const pending = { link: "", expiresAt: "" };
  let timer = 0;
  let closed = false;
  const draw = (payload) => {
    const byId = Object.fromEntries((payload.channels || []).map((view) => [view.id, view]));
    if (byId.telegram && !byId.telegram.linkWaiting) pending.link = "";
    clear(body);
    append(body,
      h("p", { class: "os-sub", text: "كل مكتب يربط قنواته بنفسه، والرسائل الواردة تصل إلى مكتبك فقط. القنوات وسيلة نقل: تصل الرسائل إلى مركز التواصل ثم تُعالج كأي عميل أو عرض أو طلب." }),
      byId.whatsapp ? whatsappCard(byId.whatsapp, reload) : null,
      byId.telegram ? telegramCard(byId.telegram, reload, pending) : null,
      h("button", { type: "button", class: "os-set-row os-card", "data-open-inbox": "", onClick: () => go("inbox") },
        h("span", { class: "os-set-icon" }, ic("inbox-in")),
        h("span", { class: "os-set-text" }, h("b", { text: "مركز التواصل" }), h("small", { text: "كل ما وصل من القنوات، مصنّفًا: اجتماعية، استفسار، عرض، طلب، متعلقة بصفقة" })),
        ic("chev-left")),
      h("section", { class: "os-card os-set-legacy" },
        h("h2", { class: "os-h2" }, ic("shield"), "الأتمتة"),
        h("p", { class: "os-sub", "data-automation": payload.automationMode || "ASSISTED", text: `الوضع الحالي: ${automationLabel(payload)}. الإرسال التلقائي للعملاء غير مفعّل.` })));
    clearTimeout(timer);
    // While a Telegram link waits for «ابدأ», check the state again so the screen turns «مرتبط» by itself.
    if (!closed && byId.telegram?.linkWaiting && pending.link) timer = setTimeout(() => { if (body.isConnected) reload().catch(() => { /* the next press or visit reloads */ }); }, 4000);
  };
  async function reload() {
    const payload = await loadChannels(session.officeId);
    if (!closed && body.isConnected) draw(payload);
  }
  reload().catch(() => { clear(body); append(body, h("div", { class: "os-alert bad", text: "تعذر تحميل حالة القنوات." })); });
  return () => { closed = true; clearTimeout(timer); };
}
