/**
 * Compact Office OS header. Office settings stay inside the new app; legacy is
 * kept only for explicitly labelled extra tools that have not migrated yet.
 */

import { h, ic, btn } from "../core/dom.js";
import { go } from "../core/nav.js";
import { session, signOutOffice } from "../core/session.js";
import { openSheet, toast } from "../core/ui.js";
import { enableNotifications, notificationStatus } from "../core/notifications.js";
import { officeDisplayName } from "../domain/office-profile-domain.js";

export function officePublicLink() {
  const office = session.office || {};
  const slug = String(office.publicSlug || "").trim().toLowerCase();
  const origin = location.origin;
  if (slug) return `${origin}/o/${encodeURIComponent(slug)}`;
  const url = new URL("/", origin);
  url.searchParams.set("office", session.officeId);
  url.searchParams.set("view", "public");
  return url.toString();
}

export async function shareOfficeLink() {
  const office = session.office || {};
  const displayName = officeDisplayName(office, session.member || {});
  const link = officePublicLink();
  const text = `${displayName}\nسجّل عقارك أو طلبك مباشرة من رابط المكتب:\n${link}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: displayName, text });
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

function openMenu() {
  const legacyUrl = `/legacy.html?officeId=${encodeURIComponent(session.officeId)}`;
  const filters = document.querySelector(".os-app[data-view=tasks] .ref-filters");
  const items = [
    filters ? h("button", { type: "button", onClick: () => { sheet.close(); filters.open = true; } }, ic("search"), "تصفية المهام") : null,
    h("button", { type: "button", onClick: () => { sheet.close(); shareOfficeLink(); } }, ic("link"), "مشاركة رابط المكتب"),
    h("button", { type: "button", onClick: async () => {
      const result = await enableNotifications();
      toast(result.message, result.ok ? "ok" : "bad");
    } }, ic("bell"), h("span", {}, "تنبيهات هذا الجهاز ", h("small", { class: "os-sub", text: `(${notificationStatus()})` }))),
    session.isManager ? h("button", { type: "button", onClick: () => { sheet.close(); go("settings"); } }, ic("gear"), "إعدادات المكتب") : null,
    h("a", { href: legacyUrl }, ic("clipboard"), "أدوات إضافية قديمة"),
    h("button", { type: "button", onClick: async () => { sheet.close(); await signOutOffice(); location.replace("/"); } }, ic("logout"), "تسجيل الخروج")
  ];
  const sheet = openSheet("القائمة", h("nav", { class: "os-menu" }, items));
}

export function renderShellHeader({ active = "office" } = {}) {
  const office = session.office || {};
  const logo = /^https:\/\//.test(String(office.logoUrl || "")) ? h("img", { src: office.logoUrl, alt: "" }) : h("span", { class: "ref-logo" });
  const displayName = officeDisplayName(office, session.member || {});
  const broker = String(office.brokerName || session.member?.displayName || session.member?.name || "").trim();
  return h("header", { class: "ref-shell-header" },
    h("div", { class: "ref-brand" }, logo),
    h("div", { class: "ref-shell-title" },
      h("h1", { text: active === "tasks" ? "المهام اليومية" : active === "repo" ? "العروض والطلبات" : displayName }),
      active === "tasks" ? h("p", { text: "أنجز مهامك بسهولة كل يوم" }) : active === "office" && broker ? h("p", { class: "ref-hello", text: "مرحبًا " + broker.split(" ")[0] }) : null),
    active !== "repo" ? h("button", { type: "button", class: "ref-bell", "aria-label": "التنبيهات", onClick: openMenu }, ic("bell")) : null,
    h("button", { type: "button", class: "os-icon-btn ref-menu", "aria-label": active === "repo" ? "رجوع" : "إعدادات المكتب", onClick: active==="repo"?()=>go("office"):()=>go("settings") }, active === "repo" ? ic("chev-left") : ic("gear")));
}

// One order on every page (RTL, right to left): المكتب — المهام اليومية — العروض والطلبات.
export const BOTTOM_NAV = Object.freeze([["office", "المكتب", "dashboard"], ["tasks", "المهام اليومية", "tasks-check"], ["repo", "العروض والطلبات", "offers"]]);
export function renderBottomNav(active = "office") {
  return h("nav", { class: "ref-bottom", "aria-label": "أقسام المكتب" }, BOTTOM_NAV.map(([route, label, icon]) => h("button", { type: "button", "aria-current": active === route ? "page" : null, onClick: () => go(route) }, ic(icon), h("span", { text: label }))));
}
export { btn };
