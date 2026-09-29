/**
 * Office header + the two main sections. Header is compact: office name, broker
 * identity, share-link button and the settings menu (role-aware).
 */

import { h, ic, btn } from "../core/dom.js";
import { go } from "../core/nav.js";
import { session, signOutOffice } from "../core/session.js";
import { state, subscribe } from "../core/state.js";
import { openSheet, toast } from "../core/ui.js";
import { filterTasks, visibleToActor } from "../domain/task-domain.js";
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
  const items = [
    h("button", { type: "button", onClick: () => { sheet.close(); shareOfficeLink(); } }, ic("link"), "مشاركة رابط المكتب"),
    h("button", { type: "button", onClick: async () => {
      const result = await enableNotifications();
      toast(result.message, result.ok ? "ok" : "bad");
    } }, ic("bell"), h("span", {}, "تنبيهات هذا الجهاز ", h("small", { class: "os-sub", text: `(${notificationStatus()})` }))),
    session.isManager ? h("button", { type: "button", onClick: () => { sheet.close(); go("settings"); } }, ic("users"), "الوسطاء والإسناد والصلاحيات") : null,
    session.isManager ? h("a", { href: legacyUrl }, ic("gear"), "إعدادات المكتب والبطاقة الرقمية والترخيص") : null,
    h("a", { href: legacyUrl }, ic("clipboard"), "أدوات إضافية (التعاون، الاستيراد، المكتبة)"),
    h("button", { type: "button", onClick: async () => { sheet.close(); await signOutOffice(); location.replace("/"); } }, ic("logout"), "تسجيل الخروج")
  ];
  const sheet = openSheet("القائمة", h("nav", { class: "os-menu" }, items));
}

export function renderShellHeader({ active = "tasks" } = {}) {
  const office = session.office || {};
  const logo = /^https:\/\//.test(String(office.logoUrl || "")) ? h("img", { src: office.logoUrl, alt: "" }) : ic("user");
  const roleLabel = session.isManager ? (session.role === "owner" ? "وسيط عقاري مرخّص" : "مدير المكتب") : "وسيط عقاري";
  const brokerName = session.role === "owner" ? (office.brokerName || "") : (session.member?.displayName || session.member?.name || "");

  const tasksCount = h("span", { class: "n" });
  const updateCount = () => {
    const mine = state.tasks.filter((t) => visibleToActor(t, { uid: session.user?.uid, isManager: session.isManager }));
    const n = filterTasks(mine, "all").length;
    tasksCount.textContent = n ? `(${n})` : "";
  };
  updateCount();
  const off = subscribe((kind) => { if (kind === "tasks") updateCount(); });

  const header = h("div", {},
    h("header", { class: "os-header" },
      h("div", { class: "os-avatar", "aria-hidden": "true" }, logo),
      h("div", { class: "os-header-text" },
        h("h1", { class: "os-office-name", text: office.officeName || "المكتب" }),
        h("p", { class: "os-broker-line" }, brokerName || "", h("small", { text: roleLabel }))
      ),
      h("button", { type: "button", class: "os-icon-btn", "aria-label": "القائمة والإعدادات", onClick: openMenu }, ic("gear"))
    ),
    h("button", { type: "button", class: "os-share-link", onClick: shareOfficeLink }, ic("link"), "مشاركة رابط المكتب"),
    h("nav", { class: "os-sections", role: "tablist", "aria-label": "أقسام المكتب" },
      h("button", { type: "button", role: "tab", class: "os-section-tab", "aria-selected": String(active === "tasks"), onClick: () => go("tasks") }, ic("calendar-clock"), h("span", {}, "المهام اليومية", " ", tasksCount)),
      h("button", { type: "button", role: "tab", class: "os-section-tab", "aria-selected": String(active === "repo"), onClick: () => go("repo") }, ic("home-plus"), "العروض والطلبات")
    )
  );
  header.addEventListener("os:detach", off);
  // Remove the listener when the header leaves the DOM.
  const observer = new MutationObserver(() => { if (!header.isConnected) { off(); observer.disconnect(); } });
  queueMicrotask(() => header.parentNode && observer.observe(document.getElementById("app"), { childList: true, subtree: true }));
  return header;
}

export { btn };
