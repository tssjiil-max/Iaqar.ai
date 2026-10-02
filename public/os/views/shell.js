/**
 * Compact platform header + main navigation. The platform brand stays stable
 * across the three main screens; each screen keeps its own local content below.
 */

import { h, ic, btn } from "../core/dom.js";
import { go } from "../core/nav.js";
import { session, signOutOffice } from "../core/session.js";
import { openSheet, toast } from "../core/ui.js";
import { enableNotifications, notificationStatus } from "../core/notifications.js";

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
  const logo = /^https:\/\//.test(String(office.logoUrl || ""))
    ? h("img", { src: office.logoUrl, alt: "" })
    : h("span", { class: "ref-logo" });
  const localTitle = active === "tasks" ? "المهام اليومية" : active === "repo" ? "العروض والطلبات" : "المكتب";

  return h("header", { class: "ref-shell-header ref-shell-platform" },
    h("div", { class: "ref-brand" }, logo),
    h("div", { class: "ref-shell-title" },
      h("h1", { text: "مكاتب عقارية ذكية" }),
      localTitle ? h("p", { class: "ref-platform-context", text: localTitle }) : null),
    active !== "repo" ? h("button", { type: "button", class: "ref-bell", "aria-label": "التنبيهات", onClick: openMenu }, ic("bell")) : null,
    h("button", {
      type: "button",
      class: "os-icon-btn ref-menu",
      "aria-label": active === "repo" ? "رجوع" : "القائمة والإعدادات",
      onClick: active === "repo" ? () => go("office") : openMenu
    }, active === "repo" ? ic("chev-left") : ic("gear")));
}

// One order on every page (RTL, right to left): المكتب — المهام اليومية — العروض والطلبات.
export const BOTTOM_NAV = Object.freeze([["office", "المكتب", "dashboard"], ["tasks", "المهام اليومية", "tasks-check"], ["repo", "العروض والطلبات", "offers"]]);
export function renderBottomNav(active = "office") {
  return h("nav", { class: "ref-bottom", "aria-label": "أقسام المكتب" }, BOTTOM_NAV.map(([route, label, icon]) => h("button", { type: "button", "aria-current": active === route ? "page" : null, onClick: () => go(route) }, ic(icon), h("span", { text: label }))));
}
export { btn };
