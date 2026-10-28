import { OFFICE_NAV, navigationSection } from "../domain/office-navigation-domain.js";
/**
 * Compact platform header + main navigation. The platform brand stays stable
 * across the three main screens; each screen keeps its own local content below.
 */

import { h, ic, btn, clear, append, emptyState, loadingState, feedback } from "../core/dom.js";
import { go } from "../core/nav.js";
import { icon3d } from "../core/icons.js";
import { session, signOutOffice } from "../core/session.js";
import { openSheet, toast } from "../core/ui.js";
import { workerBase } from "../core/runtime.js";
import { ensureShareCard } from "../core/share-card.js";
import { officeShareUrl } from "../domain/share-card-domain.js";
import { enableNotifications, notificationStatus } from "../core/notifications.js";
import { listNotifications } from "../core/live.js";
import { state } from "../core/state.js";
import { relativeAgo } from "../domain/format-domain.js";
import { newestTime, notificationViews, visibleNotifications } from "../domain/notifications-domain.js";

export function officePublicLink() {
  const office = session.office || {};
  return officeShareUrl({ slug: office.publicSlug, officeId: session.officeId, origin: location.origin, hostname: location.hostname, workerOrigin: workerBase(), preview: office.sharePreviewFormat === "immutable-v2" ? office.shareCardNonce : "" });
}

export async function shareOfficeLink() {
  const office = session.office || {};
  // Publish the immutable preview before sharing. On failure officePublicLink() safely falls back to /m.
  await ensureShareCard();
  const link = officePublicLink();
  const text = `${office.officeName || "مكتبنا"}\nسجّل عقارك أو طلبك مباشرة من رابط المكتب:\n${link}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: office.officeName || "رابط المكتب", text });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    toast("تم نسخ رابط المكتب", "ok");
  } catch (_) {
    openSheet("رابط المكتب", h("div", { class: "os-form" }, h("input", { class: "os-input", value: link, readonly: true, dir: "ltr", onFocus: (e) => e.target.select() })));
  }
}

// When the notifications list was last opened on this device (only to mark what is new).
const seenKey = () => `os.notificationsSeen.${session.officeId || ""}`;
function seenAt() { try { return Number(localStorage.getItem(seenKey())) || 0; } catch (_) { return 0; } }
function markSeen(time) { try { localStorage.setItem(seenKey(), String(time)); } catch (_) { /* ignore */ } }
let newest = { officeId: "", time: 0, checkedAt: 0 };

/** Lights the dot on the bell when a notification is newer than the last look (checked at most once a minute). */
function refreshBellDot(bell) {
  const show = () => { bell.classList.toggle("has-new", newest.officeId === session.officeId && newest.time > seenAt()); };
  show();
  if (newest.officeId === session.officeId && Date.now() - newest.checkedAt < 60000) return;
  newest = { officeId: session.officeId, time: newest.officeId === session.officeId ? newest.time : 0, checkedAt: Date.now() };
  listNotifications(session.officeId, session.isManager ? 15 : 60).then((list) => {
    newest.time = newestTime(visibleNotifications(list, { uid: session.user?.uid, isManager: session.isManager }));
    if (bell.isConnected) show();
  }).catch(() => { /* the bell still opens the list */ });
}

/** «التنبيهات»: the latest notifications; each opens the place its push link opens. */
function openNotifications() {
  const body = h("div", { class: "os-notifications", "data-notifications": "" }, loadingState({ class: "os-skeleton" }));
  const sheet = openSheet("التنبيهات", body);
  const since = seenAt();
  listNotifications(session.officeId, session.isManager ? 40 : 120).then((list) => {
    const mine = visibleNotifications(list, { uid: session.user?.uid, isManager: session.isManager });
    const views = notificationViews(mine, { tasks: state.tasks, seenAt: since });
    clear(body);
    if (!views.length) { append(body, emptyState("bell", "لا توجد تنبيهات", "تصلك هنا تنبيهات الردود والمواعيد وطلبات التدخل.")); }
    else {
      append(body, h("ul", { class: "os-notification-list" }, views.map((view) => {
        const row = h("button", { type: "button", class: "os-notification" + (view.isNew ? " is-new" : ""), "data-notification": view.id, "data-notification-route": view.route },
          h("span", { class: "os-set-text" }, h("b", { text: view.title }), view.body ? h("small", { text: view.body, dir: "auto" }) : null, h("small", { class: "when", text: relativeAgo(view.at) || "" })),
          ic("chev-left"));
        row.addEventListener("click", () => { sheet.close(); go(view.route); });
        return h("li", {}, row);
      })));
    }
    const settings = h("button", { type: "button", class: "os-btn ghost block", "data-notification-settings": "" }, ic("gear"), "إعدادات الإشعارات");
    settings.addEventListener("click", () => { sheet.close(); go("settings/notifications"); });
    append(body, settings);
    newest = { officeId: session.officeId, time: newestTime(mine), checkedAt: Date.now() };
    markSeen(Math.max(newest.time, Date.now()));
    document.querySelectorAll(".ref-bell").forEach((bell) => bell.classList.remove("has-new"));
  }).catch(() => { clear(body); append(body, feedback({ class: "os-alert bad", text: "تعذر تحميل التنبيهات." })); });
}

function openMenu() {
  const filters = document.querySelector(".os-app[data-view=tasks] .ref-filters");
  const items = [
    filters ? h("button",{type:"button",onClick:()=>{sheet.close();filters.open=true;}},ic("filter"),"تصفية المهام") : null,
    ...[["المكتب الذكي","office","dashboard"],["المهام اليومية","tasks","clipboard"],["البحث الشامل","search","search"],["المزيد","more","reference-menu"]].map(([label,route,icon])=>h("button",{type:"button",onClick:()=>{sheet.close();go(route);}},ic(icon),label)),
    h("button",{type:"button",onClick:async()=>{sheet.close();await signOutOffice();location.replace("/");}},ic("logout"),"تسجيل الخروج")
  ];
  const sheet = openSheet("القائمة", h("nav", { class: "os-menu" }, items));
}

export function renderShellHeader({ active = "office" } = {}) {
  const localTitle = active === "tasks" ? "المهام اليومية" : active === "repo" ? "العروض والطلبات" : "";

    const bell = h("button",{type:"button",class:"ref-bell","data-header-bell":"","aria-label":"التنبيهات",onClick:openNotifications},ic("bell"),h("i",{class:"ref-bell-dot"}));
    refreshBellDot(bell);
    return h("header",{class:"ref-shell-header ref-reference-header","aria-label":localTitle || "مكاتب عقارية ذكية"},
      h("button",{type:"button",class:"os-icon-btn ref-menu","aria-label":"القائمة والإعدادات",onClick:openMenu},ic("reference-menu")),
      h("span",{class:"ref-logo","aria-label":"iAqar.ai"}),
      h("h1",{text:"مكاتب عقارية ذكية"}),
      h("button",{type:"button",class:"os-icon-btn ref-search","data-header-search":"","aria-label":"البحث الشامل",onClick:()=>go("search")},ic("search")),bell,
      h("button",{type:"button",class:"os-icon-btn","aria-label":"حسابي",onClick:()=>go("more")},ic("user")));
}

// One order on every page (RTL, right to left): المكتب — المهام اليومية — العروض والطلبات.
export const BOTTOM_NAV = OFFICE_NAV;
export function renderBottomNav() {
 const selected=navigationSection(location.hash);
 return h("nav",{class:"ref-bottom ref-reference-bottom","aria-label":"أقسام المكتب"},BOTTOM_NAV.map(([route,label,icon])=>h("button",{type:"button","data-tool-route":route,"data-inbox-entry":route==="inbox"?"":null,"aria-current":route===selected?"page":null,onClick:()=>go(route)},icon3d(route,icon),h("span",{text:label}))));
}
export { btn };
