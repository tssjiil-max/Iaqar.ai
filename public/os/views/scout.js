/**
 * «باحث الفرص» — the office's background researcher, as the broker sees it:
 *   #/scout              what it found (the strong finds only), the searches it runs, «+ بحث جديد»
 *   #/scout/new          a search without a record: one sentence, or a short form
 *   #/scout/opp/<id>     one find: what, why it fits, linked to which record, source, freshness, confidence → تواصل · حفظ · تجاهل
 *   #/scout/task/<id>    one search: its mode and its own controls
 *   #/settings/scout     the manager's switches and the office's interests
 * Nothing technical is shown (no queue, no source logs, no model calls); the broker decides, the scout does the work.
 */

import { h, ic, clear, append, emptyState, field } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { session } from "../core/session.js";
import { confirmDialog, newRequestKey, openSheet, openWhatsApp, runAction, toast } from "../core/ui.js";
import {
  actOnScoutFind, controlScoutSearch, createScoutSearch, feedScout, linkScoutTelegramChat, liveWebSearch, loadScout, parseScoutText, saveScoutSettings, scoutFind, scoutForRecord, scoutSearchDetail,
  unlinkScoutTelegramChat
} from "../core/scout.js";
import { buildWhatsAppUrl, relativeAgo } from "../domain/format-domain.js";
import { PROPERTY_TYPES, RECORD_KIND, kindOf } from "../domain/records-domain.js";
import {
  BAND, BAND_LABEL, CATEGORY_LABEL, FRESHNESS_OPTIONS, adsCount, strongCount, MODE_CONFIG, MODE_OPTIONS, OPP_ACTION, OPP_STATUS, QUALITY_OPTIONS, SCOUT_MODE, SEEK, SEEK_OPTIONS, TASK_CONTROL, TASK_STATUS, TX_OPTIONS,
  statusView
} from "../domain/scout-domain.js";
import { openDraftInForm } from "./record-form.js";

const OFFICE = () => session.officeId;

function head(title, { backTo = "", fallback = "scout", action = null } = {}) {
  return h("div", { class: "os-page-head" },
    h("button", { type: "button", class: "os-back", onClick: () => (backTo ? go(backTo) : back(fallback)) }, ic("chev-right"), "رجوع"),
    h("h1", { class: "os-page-title", text: title }), action || h("span"));
}

const statusPill = (view, attrs = {}) => h("span", { class: `ref-agent-status${view.tone ? ` is-${view.tone}` : ""}`, "data-scout-status": view.state, text: view.label, ...attrs });
const bandBadge = (band) => h("span", { class: `os-badge${band === BAND.VERY_STRONG ? " ok" : ""}`, "data-find-band": band, text: `فرصة ${BAND_LABEL[band] || ""}` });
const modeBadge = (mode) => h("span", { class: `os-badge os-scout-mode${mode === SCOUT_MODE.URGENT ? " late" : mode === SCOUT_MODE.DEEP ? "" : " muted"}`, "data-task-mode": mode, text: MODE_CONFIG[mode]?.label || "" });

// ------------------------------------------------------------------ cards

function findCard(card) {
  return h("button", { type: "button", class: "os-card os-scout-find", "data-find": card.id, "data-find-category": card.category, onClick: () => go(`scout/opp/${card.id}`) },
    h("div", { class: "os-scout-find-top" },
      bandBadge(card.band),
      card.urgent ? h("span", { class: "os-badge late", text: "مستعجل" }) : null,
      card.status === OPP_STATUS.SAVED ? h("span", { class: "os-badge muted", text: "محفوظة" }) : card.status === OPP_STATUS.CONTACTED ? h("span", { class: "os-badge muted", text: "فُتح التواصل" }) : null,
      h("small", { class: "os-scout-when", text: relativeAgo(card.at) })),
    h("small", { class: "os-scout-category", text: CATEGORY_LABEL[card.category] || "" }),
    h("b", { class: "os-scout-headline", text: card.headline, dir: "auto" }),
    card.price ? h("span", { class: "os-scout-price", text: card.price }) : null,
    card.changed === "price_drop" ? h("span", { class: "os-scout-note", text: "انخفض السعر" }) : null,
    (card.why || []).length ? h("ul", { class: "os-list os-scout-why" }, card.why.slice(0, 3).map((reason) => h("li", { class: "good" }, ic("check"), reason))) : null,
    card.recordTitle ? h("span", { class: "os-scout-linked" }, ic("link"), h("span", { text: `مرتبطة بـ«${card.recordTitle}»` })) : null,
    card.sources > 1 ? h("small", { class: "os-scout-sources", text: `وُجدت في ${card.sources} مصادر` }) : null);
}

function taskRow(task) {
  return h("button", { type: "button", class: "os-card os-center-row os-scout-task", "data-task": task.id, "data-task-status": task.status, onClick: () => go(`scout/task/${task.id}`) },
    h("span", { class: "os-set-text" },
      h("b", { text: task.title, dir: "auto" }),
      h("small", {}, [task.statusLabel, task.reason, task.scope, task.found ? strongCount(task.found) : ""].filter(Boolean).join(" · "))),
    modeBadge(task.mode), ic("chev-left"));
}

// ------------------------------------------------------------------ the home card («أدوات المكتب»)

/** Compact card on the office page: state, how many strong finds wait, and the way in. Hidden where the scout is not available. */
export function scoutHomeCard() {
  const pill = h("span", { class: "ref-agent-status", "data-scout-status": "", text: "جارٍ التحقق" });
  const main = h("button", { type: "button", class: "ref-agent-needs", "data-scout-open": "", onClick: () => go("scout") }, h("span", { text: "جارٍ التحميل…" }));
  const facts = h("small", { class: "ref-agent-facts", "data-scout-facts": "" });
  const card = h("div", { class: "ref-agent-card ref-scout-card", "data-scout-card": "", hidden: true },
    h("div", { class: "ref-agent-head" }, h("span", { class: "os-set-icon" }, ic("search")), h("b", { text: "باحث الفرص" }), pill), main, facts);
  loadScout(OFFICE()).then((overview) => {
    if (!card.isConnected || overview.available === false) return;
    card.hidden = false;
    const view = statusView(overview);
    pill.textContent = view.label;
    pill.dataset.scoutStatus = view.state;
    pill.className = `ref-agent-status${view.tone ? ` is-${view.tone}` : ""}`;
    clear(main);
    const strong = overview.away?.total || 0;
    main.dataset.count = String(strong);
    if (!overview.settings?.enabled) append(main, h("span", { text: "يبحث لعروضك وطلباتك في الخلفية ولا يعرض إلا ما يستحق الاتصال." }), ic("chev-left"));
    else if (strong) append(main, h("strong", { text: String(strong) }), h("span", { text: strong === 1 ? "فرصة قوية جديدة" : strong === 2 ? "فرصتان قويتان جديدتان" : "فرص قوية جديدة" }), ic("chev-left"));
    else append(main, h("span", { text: "لا توجد فرص قوية جديدة الآن — البحث مستمر." }), ic("chev-left"));
    facts.textContent = overview.settings?.enabled ? `عمليات بحث نشطة: ${overview.counters.activeSearches}${overview.counters.urgent ? ` · مستعجل: ${overview.counters.urgent}` : ""}` : "";
  }).catch(() => { /* the office page works without it */ });
  return card;
}

// ------------------------------------------------------------------ #/scout

function feedSheet(onDone) {
  const area = h("textarea", { class: "os-textarea os-smart-text", rows: "8", "data-feed-text": "", placeholder: "الصق هنا ما وصلك في قروباتك أو محادثاتك: إعلان واحد أو عشرات. يقرأها الباحث كلها ويُظهر لك ما يستحق فقط." });
  const result = h("div", { class: "os-alert", role: "status", hidden: true, "data-feed-result": "" });
  const send = h("button", { type: "button", class: "os-btn primary block", "data-feed-send": "" }, ic("sparkles"), "اقرأها وابحث فيها");
  const sheet = openSheet("زوّد الباحث بإعلانات", h("div", { class: "os-form" },
    h("p", { class: "os-sub", text: "لا تُنشأ سجلات من هذا النص، ولا يُراسَل أحد. يطابقه الباحث مع عمليات البحث الجارية وعروض وطلبات مكتبك." }), area, result, send));
  send.addEventListener("click", () => runAction(send, async () => {
    const answer = await feedScout(OFFICE(), area.value);
    result.hidden = false;
    result.className = `os-alert ${answer.strong ? "ok" : "info"}`;
    result.textContent = answer.note || (answer.strong
      ? `قرأنا ${adsCount(answer.ads)} — ${strongCount(answer.strong)} تجدها أعلى الصفحة.`
      : `قرأنا ${adsCount(answer.ads)} — لا شيء فيها يرقى لفرصة قوية الآن، فلم نعرض شيئًا.`);
    area.value = "";
    if (onDone) onDone(answer);
    if (answer.strong) setTimeout(() => sheet.close(), 1400);
  }));
}

export function renderScout(container) {
  let alive = true;
  const body = h("div", { "data-scout-page": "" }, h("div", { class: "os-skeleton" }));
  const settingsBtn = session.isManager ? h("button", { type: "button", class: "os-icon-btn", "aria-label": "إعدادات باحث الفرص", "data-scout-settings": "", onClick: () => go("settings/scout") }, ic("gear")) : null;
  append(container, head("باحث الفرص", { backTo: "office", action: settingsBtn }), body);
  const draw = (overview) => {
    if (!alive) return;
    clear(body);
    if (overview.available === false) { append(body, h("div", { class: "os-alert info", "data-scout-unavailable": "", text: "باحث الفرص غير متاح على هذه البيئة حاليًا." })); return; }
    const view = statusView(overview);
    const on = overview.settings.enabled === true;
    const c = overview.counters;
    const stat = (value, label, name) => h("div", { class: "os-scout-stat", "data-scout-stat": name }, h("strong", { text: String(value) }), h("small", { text: label }));
    append(body, h("section", { class: "os-card os-scout-state" },
      h("div", { class: "ref-agent-head" }, h("span", { class: "os-set-icon" }, ic("search")), h("b", { text: "الحالة" }), statusPill(view)),
      on && overview.away.total ? h("div", { class: "os-scout-away", "data-scout-away": "" },
        h("b", { text: "باحث الفرص عمل أثناء غيابك" }),
        h("ul", { class: "os-list" }, overview.away.lines.map((line) => h("li", { class: "good" }, ic("check"), line)))) : null,
      on ? h("div", { class: "os-scout-stats" },
        stat(c.strongToday, "فرص قوية اليوم", "strongToday"), stat(c.activeSearches, "عمليات بحث نشطة", "activeSearches"), stat(c.urgent, "بحث مستعجل", "urgent"),
        stat(c.forOffers, "عروض نبحث لها عن مشترين", "forOffers"), stat(c.forRequests, "طلبات نبحث لها عن عقارات", "forRequests"))
        : h("p", { class: "os-sub", "data-scout-off": "", text: session.isManager
          ? "متوقف. عند تشغيله يعرف ما لدى مكتبك وما يطلبه عملاؤك، ويبحث باستمرار عن الطرف الآخر، ولا يعرض لك إلا الفرص القوية."
          : "باحث الفرص متوقف في هذا المكتب. يشغّله مدير المكتب من الإعدادات." }),
      !on && session.isManager ? h("button", { type: "button", class: "os-btn primary block", "data-scout-enable": "", onClick: (event) => runAction(event.currentTarget, async () => { await saveScoutSettings(OFFICE(), { enabled: true }); refresh(); }, { success: "يعمل باحث الفرص الآن" }) }, ic("play"), "تشغيل باحث الفرص") : null,
      overview.health?.failing ? h("div", { class: "os-alert warn", text: "أحد المصادر متعطل مؤقتًا — البحث مستمر في بقية المصادر." }) : null));
    if (!on) return;
    append(body,
      h("div", { class: "os-btn-row os-scout-actions" },
        h("button", { type: "button", class: "os-btn primary", "data-scout-new": "", onClick: () => go("scout/new") }, ic("plus"), "بحث جديد"),
        h("button", { type: "button", class: "os-btn secondary", "data-scout-feed": "", onClick: () => feedSheet(() => refresh()) }, ic("inbox-in"), "زوّد الباحث بإعلانات")),
      h("section", { "data-scout-finds": "" },
        h("div", { class: "os-card-head" }, h("h2", { class: "os-h2" }, ic("sparkles"), "الفرص القوية"), overview.board.length ? h("span", { class: "os-count", text: String(overview.board.length) }) : null),
        overview.board.length ? overview.board.map(findCard)
          : h("div", { class: "os-card" }, emptyState("search", "لا توجد فرص قوية الآن", "الباحث لا يعرض إلا ما يستحق الاتصال. سنخبرك فور العثور على فرصة قوية."))),
      h("section", { "data-scout-tasks": "" },
        h("div", { class: "os-card-head" }, h("h2", { class: "os-h2" }, ic("refresh"), "عمليات البحث"), overview.tasks.length ? h("span", { class: "os-count", text: String(overview.tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length) }) : null),
        overview.tasks.length ? h("div", { class: "os-center-list" }, overview.tasks.map(taskRow))
          : h("div", { class: "os-card" }, h("p", { class: "os-sub", text: "لا توجد عمليات بحث بعد. أضف عرضًا أو طلبًا، أو ابدأ بحثًا جديدًا." }))));
  };
  const refresh = () => loadScout(OFFICE(), { fresh: true }).then(draw).catch((error) => { if (!alive) return; clear(body); append(body, h("div", { class: "os-alert bad", text: error?.message || "تعذر تحميل باحث الفرص." })); });
  refresh();
  return () => { alive = false; };
}

// ------------------------------------------------------------------ #/scout/new

const MODE_HINT = Object.freeze({
  GENERAL: "مراقبة دائمة بدورات اقتصادية، وتنبيه للفرص القوية جدًا فقط.",
  DEEP: "دراسة هذا الهدف بتوسع ليوم كامل: صيغ بحث أكثر، أحياء مجاورة، أنواع قريبة، ثم ملخص عند الانتهاء.",
  URGENT: "تبدأ أول دورة الآن، ثم بحث كل بضع دقائق لثلاثة أيام، وتنبيه فوري لكل فرصة قوية."
});

function segmented(name, options, value, { onChange } = {}) {
  let current = value;
  const group = h("div", { class: "os-seg", role: "group", "data-seg": name },
    options.map((option) => {
      const button = h("button", { type: "button", "aria-pressed": String(option.id === current), "data-seg-value": String(option.id), text: option.label });
      button.addEventListener("click", () => {
        current = option.id;
        group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
        if (onChange) onChange(current);
      });
      return button;
    }));
  group.value = () => current;
  group.set = (next) => { const b = group.querySelector(`[data-seg-value="${next}"]`); if (b) b.click(); };
  return group;
}

export function renderScoutNew(container) {
  const hint = h("small", { class: "os-field-hint", "data-mode-hint": "", text: MODE_HINT.GENERAL });
  const mode = segmented("mode", MODE_OPTIONS, SCOUT_MODE.GENERAL, { onChange: (value) => { hint.textContent = MODE_HINT[value]; } });
  const tx = segmented("tx", TX_OPTIONS, "sale");
  const seek = h("select", { class: "os-input", name: "seek" }, SEEK_OPTIONS.map((o) => h("option", { value: o.id, text: o.label })));
  const type = h("select", { class: "os-input", name: "propertyType" }, h("option", { value: "", text: "أي نوع" }), PROPERTY_TYPES.map((t) => h("option", { value: t, text: t })));
  const city = h("input", { class: "os-input", name: "city", value: session.office?.city || "", autocomplete: "off" });
  const districts = h("input", { class: "os-input", name: "districts", placeholder: "مثال: شوران، الهجرة", autocomplete: "off" });
  const priceMin = h("input", { class: "os-input", name: "priceMin", inputmode: "numeric", dir: "ltr", placeholder: "من" });
  const priceMax = h("input", { class: "os-input", name: "priceMax", inputmode: "numeric", dir: "ltr", placeholder: "إلى" });
  const areaMin = h("input", { class: "os-input", name: "areaMin", inputmode: "numeric", dir: "ltr", placeholder: "من" });
  const areaMax = h("input", { class: "os-input", name: "areaMax", inputmode: "numeric", dir: "ltr", placeholder: "إلى" });
  const fresh = h("select", { class: "os-input", name: "freshnessDays" }, h("option", { value: "", text: "حسب نوع البحث" }), FRESHNESS_OPTIONS.map((o) => h("option", { value: String(o.id), text: o.label })));
  const owner = h("input", { type: "checkbox", name: "preferDirectOwner" });
  const cityWide = h("input", { type: "checkbox", name: "allowCityWide" });
  const sentence = h("textarea", { class: "os-textarea", rows: "3", maxlength: "600", "data-scout-sentence": "", placeholder: "مثال: ابحث لي بشكل مستعجل عن عمارة للبيع في شوران أو الهجرة، بحد أقصى مليونين، ويفضل من المالك مباشرة." });
  const understood = h("div", { class: "os-alert info", role: "status", hidden: true, "data-scout-understood": "" });
  const error = h("div", { class: "os-alert bad", role: "alert", hidden: true, "data-scout-error": "" });
  const understand = h("button", { type: "button", class: "os-btn soft block", "data-scout-understand": "" }, ic("sparkles"), "افهم طلبي واملأ البحث");
  let nlText = "";
  understand.addEventListener("click", () => runAction(understand, async () => {
    const answer = await parseScoutText(OFFICE(), sentence.value);
    understood.hidden = false;
    if (!answer.understood) { understood.className = "os-alert warn"; understood.textContent = answer.message || "لم أفهم المطلوب."; return; }
    const d = answer.draft;
    nlText = d.nlText || "";
    mode.set(d.mode); seek.value = d.seek; if (d.tx) tx.set(d.tx);
    type.value = d.propertyTypes?.[0] || ""; city.value = d.city || city.value; districts.value = (d.districts || []).join("، ");
    priceMin.value = d.priceMin || ""; priceMax.value = d.priceMax || ""; areaMin.value = d.areaMin || ""; areaMax.value = d.areaMax || "";
    fresh.value = d.freshnessDays ? String(d.freshnessDays) : ""; owner.checked = d.preferDirectOwner === true;
    const missing = (answer.missing || []).map((key) => ({ tx: "بيع أم إيجار", propertyTypes: "نوع العقار أو الحي", city: "المدينة" })[key] || key);
    understood.className = `os-alert ${missing.length ? "warn" : "ok"}`;
    understood.textContent = missing.length ? `فهمت: ${answer.summary} — ينقص: ${missing.join("، ")}.` : `فهمت: ${answer.summary}. راجع ثم اضغط «ابدأ البحث».`;
  }));
  const start = h("button", { type: "button", class: "os-btn primary block", "data-scout-start": "" }, ic("search"), "ابدأ البحث");
  const requestKey = newRequestKey();
  start.addEventListener("click", () => {
    error.hidden = true;
    runAction(start, async () => {
      const result = await createScoutSearch(OFFICE(), {
        mode: mode.value(), seek: seek.value, tx: tx.value(), propertyTypes: type.value ? [type.value] : [], city: city.value, districts: districts.value,
        priceMin: priceMin.value, priceMax: priceMax.value, areaMin: areaMin.value, areaMax: areaMax.value, freshnessDays: fresh.value,
        preferDirectOwner: owner.checked, allowCityWide: cityWide.checked, nlText
      }, requestKey);
      toast(result.found ? `بدأ البحث — وجدنا ${strongCount(result.found)}` : "بدأ البحث — سنخبرك عند العثور على فرصة قوية", "ok");
      go(result.found ? "scout" : `scout/task/${result.taskId}`);
    }, { onError: (e) => { error.hidden = false; error.textContent = e?.message || "تعذر بدء البحث"; } });
  });
  append(container, head("بحث جديد"),
    h("section", { class: "os-card os-form" },
      h("label", { class: "os-field" }, h("span", { text: "ماذا تريد أن أبحث لك عنه؟" }), sentence),
      understand, understood),
    h("section", { class: "os-card os-form", "data-scout-form": "" },
      h("div", { class: "os-field" }, h("span", { text: "نوع البحث" }), mode, hint),
      field("أبحث عن", seek),
      h("div", { class: "os-field" }, h("span", { text: "العملية" }), tx),
      field("نوع العقار", type),
      h("div", { class: "os-row2" }, field("المدينة", city), field("الأحياء", districts, { hint: "حي واحد أو عدة أحياء، بينها فاصلة" })),
      h("div", { class: "os-field" }, h("span", { text: "السعر" }), h("div", { class: "os-row2" }, priceMin, priceMax)),
      h("details", { class: "os-scout-more" }, h("summary", { text: "خيارات إضافية" }),
        h("div", { class: "os-form" },
          h("div", { class: "os-field" }, h("span", {}, "المساحة", h("small", { text: " (اختياري)" })), h("div", { class: "os-row2" }, areaMin, areaMax)),
          field("الحداثة", fresh, { optional: true }),
          h("label", { class: "os-pref-row" }, h("span", { text: "أفضّل المالك المباشر" }), owner),
          h("label", { class: "os-pref-row" }, h("span", { text: "وسّع للمدينة كاملة إذا لم توجد نتائج في الأحياء والمجاورة" }), cityWide))),
      error, start));
  return null;
}

// ------------------------------------------------------------------ #/scout/opp/<id>

function contactSheet(find, onOpened) {
  const { phone, route, name } = find.contact;
  const wa = buildWhatsAppUrl(phone, "");
  const opened = () => { actOnScoutFind(OFFICE(), find.id, OPP_ACTION.CONTACT).then(onOpened).catch(() => {}); };
  openSheet("تواصل", h("div", { class: "os-form" },
    h("div", { class: "os-party-head" }, h("div", { class: "av" }, ic("user")), h("div", {}, h("b", { text: name || find.advertiser || "المعلن" }), phone ? h("span", { dir: "ltr", "data-find-phone": "", text: phone }) : null)),
    h("p", { class: "os-sub", text: "تتواصل أنت بنفسك. باحث الفرص لا يرسل أي رسالة لأحد، ويسجّل فقط أنك فتحت التواصل." }),
    h("div", { class: "os-btn-row" },
      phone ? h("a", { class: "os-btn secondary", href: `tel:${phone}`, "data-find-call": "", onClick: opened }, ic("phone"), "اتصال") : null,
      wa ? h("button", { type: "button", class: "os-btn whatsapp", "data-find-whatsapp": "", onClick: () => { openWhatsApp(wa); opened(); } }, ic("whatsapp"), "واتساب") : null,
      !phone && route ? h("a", { class: "os-btn primary", href: route, target: "_blank", rel: "noopener", "data-find-route": "", onClick: opened }, ic("link"), "فتح صفحة التواصل في المصدر") : null)));
}

export function renderScoutFind(container, { id }) {
  let alive = true;
  const body = h("div", { "data-scout-find-page": "" }, h("div", { class: "os-skeleton" }));
  append(container, head("فرصة"), body);
  const row = (label, value, name) => (value ? h("div", { class: "ref-detail-row", "data-find-row": name }, h("small", { text: label }), h("b", { text: value, dir: "auto" })) : null);
  const draw = (find) => {
    if (!alive) return;
    clear(body);
    const act = (action, label, kind, iconName, done) => {
      const button = h("button", { type: "button", class: `os-btn ${kind}`, "data-find-action": action }, ic(iconName), label);
      button.addEventListener("click", () => runAction(button, async () => { await actOnScoutFind(OFFICE(), find.id, action); done(); }));
      return button;
    };
    const reload = () => scoutFind(OFFICE(), id).then((answer) => draw(answer.find)).catch(() => {});
    const contactable = Boolean(find.contact.phone || find.contact.route);
    const closed = [OPP_STATUS.IGNORED, OPP_STATUS.CONVERTED].includes(find.status);
    append(body,
      h("section", { class: "os-card", "data-find-status": find.status },
        h("div", { class: "os-scout-find-top" }, bandBadge(find.band),
          find.status === OPP_STATUS.SAVED ? h("span", { class: "os-badge muted", text: "محفوظة" }) : find.status === OPP_STATUS.CONTACTED ? h("span", { class: "os-badge muted", text: "فُتح التواصل" })
            : find.status === OPP_STATUS.IGNORED ? h("span", { class: "os-badge muted", text: "تم تجاهلها" }) : find.status === OPP_STATUS.CONVERTED ? h("span", { class: "os-badge ok", text: "أُضيفت لسجلاتك" }) : null),
        h("small", { class: "os-scout-category", text: find.categoryLabel }),
        h("h2", { class: "os-task-title", text: find.headline, dir: "auto" }),
        h("p", { class: "os-sub", text: [find.price, find.area, find.rooms ? `${find.rooms} غرف` : ""].filter(Boolean).join(" · ") }),
        find.changes.length ? h("p", { class: "os-scout-note", "data-find-price-history": "", text: `تغيّر السعر: ${find.changes.map((c) => `${c.from.toLocaleString("en-US")} ← ${c.to.toLocaleString("en-US")}`).join("، ")}` }) : null),
      h("section", { class: "os-card", "data-find-why": "" },
        h("h2", { class: "os-h2", text: "لماذا هي مناسبة؟" }),
        h("ul", { class: "os-list", style: { marginTop: "8px" } },
          find.why.map((reason) => h("li", { class: "good" }, ic("check"), reason)),
          find.notes.map((note) => h("li", { class: "warn" }, ic("alert"), note))),
        find.recordId ? h("button", { type: "button", class: "os-btn soft block", style: { marginTop: "10px", justifyContent: "space-between" }, "data-find-record": find.recordId, onClick: () => go(`record/${find.recordId}`) },
          h("span", { text: `مرتبطة بـ«${find.recordTitle || "سجل في مكتبك"}»` }), ic("chev-left")) : null),
      h("section", { class: "os-card ref-detail-facts", "data-find-facts": "" },
        row("المصدر", find.sourceCount > 1 ? `${find.sources.join("، ")} — وُجدت في ${find.sourceCount} مصادر` : find.sources.join("، "), "source"),
        row("حداثة المعلومة", find.freshness, "freshness"),
        row("مستوى الثقة", find.confidence, "confidence"),
        row("صفة المعلن", find.advertiser, "advertiser"),
        find.url ? h("a", { class: "os-link-btn", href: find.url, target: "_blank", rel: "noopener", text: "فتح الإعلان في مصدره" }) : null,
        h("details", { class: "os-quick-original" }, h("summary", { text: "نص الإعلان" }), h("p", { text: find.text, dir: "auto" }))),
      closed
        ? h("div", { class: "os-btn-row" }, find.status === OPP_STATUS.IGNORED ? act(OPP_ACTION.RESTORE, "إعادة للفرص", "secondary", "restore", reload) : h("button", { type: "button", class: "os-btn secondary", onClick: () => go("repo") }, ic("offers"), "العروض والطلبات"))
        : h("div", { class: "os-form", "data-find-actions": "" },
          contactable ? h("button", { type: "button", class: "os-btn primary block", "data-find-action": "CONTACT", onClick: () => contactSheet(find, reload) }, ic("phone"), "تواصل")
            : h("div", { class: "os-alert warn", text: "لا توجد وسيلة تواصل لهذه الفرصة بعد." }),
          h("div", { class: "os-btn-row" },
            find.status === OPP_STATUS.SAVED ? null : act(OPP_ACTION.SAVE, "حفظ لوقت لاحق", "secondary", "heart", () => { toast("حُفظت الفرصة", "ok"); reload(); }),
            act(OPP_ACTION.IGNORE, "تجاهل", "secondary", "x", () => { toast("لن تظهر هذه الفرصة مجددًا"); go("scout"); })),
          h("button", { type: "button", class: "os-btn soft block", "data-find-convert": "", onClick: () => {
            // The normal record form, pre-filled: the broker reviews and saves; matching and Daily Tasks continue as for any record.
            openDraftInForm({
              listing: find.draft, origin: { channel: "OTHER", role: find.draftRole }, returnTo: `scout/opp/${find.id}`,
              onSaved: (recordId) => { actOnScoutFind(OFFICE(), find.id, OPP_ACTION.CONVERTED, recordId).catch(() => {}); }
            });
            go(`record/new?kind=${find.draft.kind || "OFFER"}`);
          } }, ic("plus"), "أضفها لسجلات مكتبي")));
  };
  scoutFind(OFFICE(), id).then((answer) => draw(answer.find)).catch((error) => { if (!alive) return; clear(body); append(body, h("div", { class: "os-alert bad", text: error?.message || "تعذر فتح الفرصة." })); });
  return () => { alive = false; };
}

// ------------------------------------------------------------------ #/scout/task/<id>

export function renderScoutTask(container, { id }) {
  let alive = true;
  const body = h("div", { "data-scout-task-page": "" }, h("div", { class: "os-skeleton" }));
  append(container, head("عملية بحث"), body);
  const load = () => scoutSearchDetail(OFFICE(), id).then(draw).catch((error) => { if (!alive) return; clear(body); append(body, h("div", { class: "os-alert bad", text: error?.message || "تعذر فتح البحث." })); });
  const control = (action, label, kind, iconName, { confirm = null, mode = "", success = "" } = {}) => {
    const button = h("button", { type: "button", class: `os-btn ${kind}`, "data-task-control": action }, ic(iconName), label);
    button.addEventListener("click", async () => {
      if (confirm && !(await confirmDialog(confirm))) return;
      const result = await runAction(button, () => controlScoutSearch(OFFICE(), id, action, mode), { success });
      if (result?.ok) { if (action === TASK_CONTROL.RUN_NOW) toast(result.found ? `انتهت الدورة — ${strongCount(result.found)} جديدة` : "انتهت الدورة — لا جديد يستحق العرض", "ok"); load(); }
    });
    return button;
  };
  function draw({ task, board, liveSearch }) {
    if (!alive) return;
    clear(body);
    const running = task.status === TASK_STATUS.ACTIVE;
    const modes = task.origin === "DISCOVERY" ? null : segmented("taskMode", MODE_OPTIONS, task.mode, {
      onChange: (value) => { if (value !== task.mode) runAction(null, () => controlScoutSearch(OFFICE(), id, TASK_CONTROL.SET_MODE, value), { success: `أصبح البحث ${MODE_CONFIG[value].label}` }).then(load); }
    });
    append(body,
      h("section", { class: "os-card", "data-task-status": task.status },
        h("div", { class: "os-scout-find-top" }, modeBadge(task.mode), h("span", { class: `os-badge${running ? " ok" : " muted"}`, "data-task-state": task.status, text: task.statusLabel })),
        h("h2", { class: "os-task-title", text: task.title, dir: "auto" }),
        h("p", { class: "os-sub", text: [task.summary, task.scope, task.reason].filter(Boolean).join(" · ") }),
        task.nlText ? h("p", { class: "os-sub", dir: "auto", text: `«${task.nlText}»` }) : null,
        task.recordId ? h("button", { type: "button", class: "os-btn soft block", style: { marginTop: "10px", justifyContent: "space-between" }, onClick: () => go(`record/${task.recordId}`) }, h("span", { text: "فتح السجل المرتبط" }), ic("chev-left")) : null),
      running && modes ? h("section", { class: "os-card os-form" }, h("div", { class: "os-field" }, h("span", { text: "نوع البحث" }), modes, h("small", { class: "os-field-hint", text: MODE_HINT[task.mode] }))) : null,
      h("div", { class: "os-btn-row", "data-task-controls": "" },
        running ? control(TASK_CONTROL.RUN_NOW, "ابحث الآن", "primary", "refresh") : null,
        task.canPause ? control(TASK_CONTROL.PAUSE, "إيقاف مؤقت", "secondary", "pause", { success: "أُوقف هذا البحث مؤقتًا" }) : null,
        task.canResume ? control(TASK_CONTROL.RESUME, "استئناف", "primary", "play", { success: "عاد البحث يعمل" }) : null,
        task.canEnd ? control(TASK_CONTROL.END, "إنهاء", "danger", "x", { confirm: { title: "إنهاء هذا البحث؟", text: "تبقى الفرص التي وجدها. لا يتأثر باحث الفرص ولا بقية عمليات البحث.", confirmLabel: "إنهاء", danger: true }, success: "أُنهي البحث" }) : null),
      liveSearch && task.origin !== "DISCOVERY" ? h("button", { type: "button", class: "os-btn soft block", "data-task-live": "", onClick: () => liveSearchSheet(id) }, ic("search"), "ابحث في الويب الآن (Google)") : null,
      h("section", { "data-task-finds": "" },
        h("div", { class: "os-card-head" }, h("h2", { class: "os-h2" }, ic("sparkles"), "ما وجده هذا البحث")),
        board.length ? board.map(findCard) : h("div", { class: "os-card" }, h("p", { class: "os-sub", text: running ? "لا توجد فرص قوية بعد. البحث مستمر، وسنخبرك عند العثور على ما يستحق." : "لم يجد هذا البحث فرصًا قوية." }))));
  }
  load();
  return () => { alive = false; };
}

/**
 * «ابحث في الويب الآن»: what Google Search answers for this search, at this moment. It is shown as it came — the
 * answer, its sources, and Google's own suggestions block — and it is not kept: closing the sheet is the end of it.
 */
function liveSearchSheet(taskId) {
  const body = h("div", { class: "os-form", "data-live-search": "" }, h("div", { class: "os-skeleton" }), h("p", { class: "os-sub", text: "جارٍ البحث في الويب…" }));
  openSheet("بحث مباشر في الويب", body);
  liveWebSearch(OFFICE(), taskId).then((result) => {
    clear(body);
    if (!result.grounded) { append(body, h("div", { class: "os-alert info", "data-live-empty": "", text: "لم يُظهر بحث الويب نتائج مناسبة لهذا البحث الآن." })); return; }
    // Google's block is shown as Google sends it, in a closed frame: its links open in a new tab and it runs nothing here.
    const suggestions = result.suggestions ? h("iframe", { class: "os-live-suggest", title: "اقتراحات بحث Google", sandbox: "allow-popups allow-popups-to-escape-sandbox", referrerpolicy: "no-referrer", "data-live-suggest": "" }) : null;
    if (suggestions) suggestions.srcdoc = result.suggestions;
    append(body,
      h("p", { class: "os-sub", dir: "auto", text: `«${result.question}»` }),
      h("div", { class: "os-live-answer", dir: "auto", "data-live-answer": "", text: result.answer }),
      h("div", { class: "os-live-sources", "data-live-sources": "" }, h("b", { text: "المصادر" }),
        result.sources.map((source) => h("a", { class: "os-link-btn", href: source.url, target: "_blank", rel: "noopener noreferrer", dir: "auto", text: source.title || "فتح المصدر" }))),
      suggestions,
      h("p", { class: "os-sub", text: "نتائج بحث Google كما وردت. لا تُحفظ ولا تدخل في فرص الباحث — افتح المصدر للتحقق والتواصل." }));
  }).catch((error) => { clear(body); append(body, h("div", { class: "os-alert warn", "data-live-error": "", text: error?.message || "تعذر البحث في الويب الآن." })); });
}

// ------------------------------------------------------------------ #/settings/scout

export function renderScoutSettings(container) {
  append(container, head("باحث الفرص", { backTo: "settings" }));
  if (!session.isManager) { append(container, h("div", { class: "os-alert warn", text: "هذه الإعدادات لمدير المكتب فقط." })); return null; }
  const body = h("div", { "data-scout-settings": "" }, h("div", { class: "os-skeleton" }));
  append(container, body);
  const draw = (overview) => {
    clear(body);
    if (overview.available === false) { append(body, h("div", { class: "os-alert info", text: "باحث الفرص غير متاح على هذه البيئة حاليًا." })); return; }
    const s = overview.settings;
    const view = statusView(overview);
    const toggle = h("button", { type: "button", class: `os-btn ${s.enabled ? "secondary" : "primary"} block`, "data-scout-toggle": s.enabled ? "off" : "on" }, ic(s.enabled ? "pause" : "play"), s.enabled ? "إيقاف باحث الفرص" : "تشغيل باحث الفرص");
    toggle.addEventListener("click", () => runAction(toggle, async () => { await saveScoutSettings(OFFICE(), { enabled: !s.enabled }); reload(); }, { success: s.enabled ? "أُوقف باحث الفرص — نتائجه وإعداداته محفوظة" : "يعمل باحث الفرص الآن" }));
    const general = h("input", { type: "checkbox", "data-scout-general": "" }); general.checked = s.generalEnabled;
    const city = h("input", { class: "os-input", name: "city", value: s.city || "" });
    const districts = h("input", { class: "os-input", name: "districts", value: (s.districts || []).join("، "), placeholder: "مثال: شوران، العزيزية" });
    const chosen = new Set(s.propertyTypes || []);
    const types = h("div", { class: "os-chips", "data-scout-types": "" }, PROPERTY_TYPES.map((type) => {
      const chip = h("button", { type: "button", class: "os-chip", "aria-pressed": String(chosen.has(type)), text: type });
      chip.addEventListener("click", () => { if (chosen.has(type)) chosen.delete(type); else chosen.add(type); chip.setAttribute("aria-pressed", String(chosen.has(type))); });
      return chip;
    }));
    const sale = h("input", { type: "checkbox", "data-scout-purpose": "sale" }); sale.checked = s.purposes.includes("sale");
    const rent = h("input", { type: "checkbox", "data-scout-purpose": "rent" }); rent.checked = s.purposes.includes("rent");
    const owner = h("input", { type: "checkbox", "data-scout-owner": "" }); owner.checked = s.preferDirectOwner;
    const push = h("input", { type: "checkbox", "data-scout-push": "" }); push.checked = s.notifyPush;
    const quality = segmented("minQuality", QUALITY_OPTIONS, s.minQuality);
    const sourceBoxes = overview.sources.map((source) => { const box = h("input", { type: "checkbox", "data-scout-source": source.id }); box.checked = source.on; return { id: source.id, box, label: source.label }; });
    const telegram = overview.telegram;
    const addChat = h("button", { type: "button", class: "os-btn secondary block", "data-scout-chat-add": "" }, ic("send"), "أضف قروبًا أو قناة");
    addChat.addEventListener("click", () => runAction(addChat, async () => {
      const link = await linkScoutTelegramChat(OFFICE());
      if (link.state !== "PENDING") { toast(link.message || "بوت المنصة غير مفعّل على هذه البيئة"); return; }
      const line = h("input", { class: "os-input", readonly: true, dir: "ltr", "data-scout-chat-command": "", value: link.command });
      openSheet("ربط قروب أو قناة تيليجرام", h("div", { class: "os-form" },
        h("p", { class: "os-sub", text: "القروب: اضغط الزر واختر القروب — يُضاف بوت المنصة إليه ويكتمل الربط. ثم اجعل البوت مشرفًا ليقرأ الإعلانات." }),
        h("a", { class: "os-btn primary block", href: link.groupLink, target: "_blank", rel: "noopener noreferrer", "data-scout-chat-link": "" }, ic("send"), "اختر القروب في تيليجرام"),
        h("p", { class: "os-sub", text: `القناة: أضف @${link.botUsername} مشرفًا فيها، ثم انشر هذا السطر في القناة:` }),
        line,
        h("p", { class: "os-sub", text: "الرابط صالح لربع ساعة ولمرة واحدة. لا تُحفظ إلا الرسائل التي تُقرأ كإعلان عقاري." })), { onClose: reload });
    }));
    const chatRow = (chat) => {
      const remove = h("button", { type: "button", class: "os-btn soft", "data-scout-chat-remove": chat.chatId }, ic("x"), "فصل");
      remove.addEventListener("click", async () => {
        if (!(await confirmDialog({ title: "فصل هذا القروب؟", text: "يتوقف الباحث عن قراءة إعلاناته. الفرص التي وُجدت تبقى.", confirmLabel: "فصل", danger: true }))) return;
        await runAction(remove, () => unlinkScoutTelegramChat(OFFICE(), chat.chatId), { success: "فُصل القروب" });
        reload();
      });
      return h("div", { class: "os-pref-row", "data-scout-chat": chat.chatId }, h("span", { dir: "auto", text: `${chat.title}${chat.type === "channel" ? " · قناة" : ""}` }), remove);
    };
    const save = h("button", { type: "button", class: "os-btn primary block", "data-scout-save": "" }, ic("check"), "حفظ الإعدادات");
    save.addEventListener("click", () => runAction(save, async () => {
      await saveScoutSettings(OFFICE(), {
        generalEnabled: general.checked, city: city.value, districts: districts.value, propertyTypes: [...chosen], purposes: [sale.checked ? "sale" : "", rent.checked ? "rent" : ""].filter(Boolean),
        preferDirectOwner: owner.checked, notifyPush: push.checked, minQuality: quality.value(), sources: Object.fromEntries(sourceBoxes.map((x) => [x.id, x.box.checked]))
      });
      reload();
    }, { success: "تم حفظ إعدادات باحث الفرص" }));
    append(body,
      h("section", { class: "os-card" },
        h("div", { class: "os-card-head" }, h("h2", { class: "os-h2", text: "الباحث" }), statusPill(view, { "data-scout-settings-state": view.state })),
        h("p", { class: "os-sub", style: { marginBottom: "10px" }, text: "يبحث في الخلفية حتى والتطبيق مغلق. عند الإيقاف تتوقف كل عمليات البحث، وتبقى النتائج والإعدادات كما هي. لا يراسل أحدًا في أي حال." }),
        toggle),
      h("section", { class: "os-card" },
        h("h2", { class: "os-h2", text: "البحث العام 24/7" }),
        h("div", { class: "os-pref-list" }, h("label", { class: "os-pref-row" }, h("span", { text: "ابحث تلقائيًا لكل عرض أو طلب مفتوح لا يوجد له طرف مقابل، واكتشف فرصًا جديدة تناسب نشاط المكتب" }), general))),
      h("section", { class: "os-card os-form" },
        h("h2", { class: "os-h2", text: "نطاق عمل المكتب" }),
        h("p", { class: "os-sub", text: "تُضبط مرة واحدة، ويعمل بها الباحث تلقائيًا." }),
        h("div", { class: "os-row2" }, field("المدينة", city), field("الأحياء المهمة", districts, { optional: true })),
        h("div", { class: "os-field" }, h("span", {}, "أنواع العقارات", h("small", { text: " (بدون اختيار = كل الأنواع)" })), types),
        h("div", { class: "os-pref-list" },
          h("label", { class: "os-pref-row" }, h("span", { text: "بيع" }), sale),
          h("label", { class: "os-pref-row" }, h("span", { text: "إيجار" }), rent),
          h("label", { class: "os-pref-row" }, h("span", { text: "أولوية للمالك المباشر" }), owner)),
        h("div", { class: "os-field" }, h("span", { text: "الحد الأدنى لجودة الفرصة المعروضة" }), quality)),
      h("section", { class: "os-card" },
        h("h2", { class: "os-h2", text: "التنبيهات" }),
        h("div", { class: "os-pref-list" }, h("label", { class: "os-pref-row" }, h("span", { text: "إشعار على الجوال عند الفرص التي تستحق انتباهك" }), push)),
        h("p", { class: "os-sub", text: "تظهر الفرص القوية دائمًا في صفحة باحث الفرص وفي جرس التنبيهات." })),
      h("section", { class: "os-card", "data-scout-sources": "" },
        h("h2", { class: "os-h2", text: "المصادر" }),
        h("p", { class: "os-sub", text: "تظهر هنا المصادر التي تم التحقق من جواز استخدامها فقط." }),
        h("div", { class: "os-pref-list" }, sourceBoxes.map((x) => h("label", { class: "os-pref-row" }, h("span", { text: x.label }), x.box))),
        (overview.pendingSources || []).length ? h("div", { class: "os-scout-pending", "data-scout-pending": "" },
          h("b", { text: "غير مفعّلة بعد" }),
          overview.pendingSources.map((source) => h("p", { class: "os-sub", "data-scout-pending-source": source.id }, h("b", { text: `${source.label}: ` }), source.reason))) : null),
      telegram?.configured ? h("section", { class: "os-card", "data-scout-chats": "" },
        h("h2", { class: "os-h2", text: "قروبات وقنوات تيليجرام" }),
        h("p", { class: "os-sub", text: "أضف بوت المنصة إلى قروب عقاري أو قناة أنت فيها، فيقرأ الباحث إعلاناتها تلقائيًا بدل اللصق اليدوي. يحتاج موافقة مشرف القروب." }),
        telegram.chats.length ? h("div", { class: "os-pref-list" }, telegram.chats.map(chatRow)) : null,
        telegram.chats.length < telegram.limit ? addChat : h("p", { class: "os-sub", text: `الحد ${telegram.limit} قروبات أو قنوات.` })) : null,
      save);
  };
  const reload = () => loadScout(OFFICE(), { fresh: true }).then(draw).catch(() => { clear(body); append(body, h("div", { class: "os-alert bad", text: "تعذر تحميل إعدادات باحث الفرص." })); });
  reload();
  return null;
}

// ------------------------------------------------------------------ inside a record: «ابحث عن مشتري» / «ابحث عن عقار»

/**
 * One press starts the search for this record's other side, with everything read from the record. While it runs
 * the row shows it, opens it, and lets the broker stop it for this record only. Hidden where the scout is not available.
 */
export function recordScoutRow(record) {
  const isOffer = kindOf(record) === RECORD_KIND.OFFER;
  const label = isOffer ? "ابحث عن مشتري" : "ابحث عن عقار";
  const box = h("div", { class: "os-scout-record", "data-scout-record": record.id, hidden: true });
  const draw = (answer) => {
    if (!answer || answer.available === false) { box.hidden = true; return; }
    box.hidden = false;
    clear(box);
    const task = answer.task;
    const running = task?.status === TASK_STATUS.ACTIVE;
    if (running) {
      append(box,
        h("p", { class: "os-scout-record-state", "data-scout-record-state": "running" }, ic("search"), h("span", { text: `باحث الفرص يبحث ${isOffer ? "عن مشترٍ لهذا العرض" : "عن عقار لهذا الطلب"} · ${task.modeLabel}${task.scope ? ` · ${task.scope}` : ""}` })),
        h("div", { class: "os-btn-row" },
          h("button", { type: "button", class: "os-btn soft", "data-scout-record-open": "", onClick: () => go(`scout/task/${task.id}`) }, ic("eye"), task.found ? `ما وجده (${task.found})` : "فتح البحث"),
          task.mode !== SCOUT_MODE.URGENT ? action("START", "اجعله مستعجلًا", "secondary", "flag", SCOUT_MODE.URGENT, "أصبح البحث مستعجلًا — بدأت أول دورة") : null,
          action("STOP", "إيقاف البحث لهذا السجل", "secondary", "pause", "", "أُوقف البحث لهذا السجل فقط")));
    } else {
      append(box, action("START", label, "primary block", "search", "", ""),
        task?.status === TASK_STATUS.PAUSED ? h("small", { class: "os-sub", "data-scout-record-state": "paused", text: task.reason ? `البحث متوقف: ${task.reason}` : "البحث متوقف لهذا السجل" }) : null);
    }
  };
  function action(verb, text, kind, iconName, mode, success) {
    const button = h("button", { type: "button", class: `os-btn ${kind}`, "data-scout-record-action": mode ? `${verb}:${mode}` : verb }, ic(iconName), text);
    button.addEventListener("click", () => runAction(button, async () => {
      const result = await scoutForRecord(OFFICE(), record.id, verb, mode);
      if (verb === "START" && !success) toast(result.found ? `بدأ البحث — وجدنا ${strongCount(result.found)}` : "بدأ البحث — سنخبرك عند العثور على فرصة قوية", "ok");
      else if (success) toast(success, "ok");
      draw({ available: true, task: result.task });
    }));
    return button;
  }
  scoutForRecord(OFFICE(), record.id).then(draw).catch(() => { box.hidden = true; });
  return box;
}
