/**
 * Content-area view models. UI binds to these, not to Firestore field names.
 */

import { parseOpportunityIdFromHash } from "./opportunity-navigation-domain.js";

export const CONTENT_V2_COPY = Object.freeze({
  opportunities: {
    kicker: "المحتوى الجديد",
    title: "العروض والطلبات",
    body: "قائمة الفرص ستُبنى هنا لاحقًا بنفس بساطة وتنظيم البطاقة. الهوية والبحث بالصوت والمطابقة الداخلية تبقى كما هي."
  },
  tasks: {
    kicker: "المحتوى الجديد",
    title: "المهام اليومية",
    body: "المهام اليومية ستُبنى هنا لاحقًا. لا تظهر أزرار المتابعة أو اليوم/غدًا في هذه المرحلة."
  },
  opportunity: {
    kicker: "المحتوى الجديد",
    title: "تفاصيل الفرصة",
    body: "تفاصيل الفرصة ستُبنى هنا لاحقًا. المعرّف يُقرأ من الرابط حتى نربط الصفحة الجديدة دون كسر البيانات."
  }
});

export function currentContentView(locationLike = {}, tabsState) {
  const id = parseOpportunityIdFromHash(locationLike.hash || "");
  if (id) return { name: "opportunity", id };
  const tabs = tabsState || { main: "operations" };
  return { name: tabs.main === "opportunities" ? "opportunities" : "tasks" };
}

export function escapeContentHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

export function buildContentV2Html(view) {
  const copy = CONTENT_V2_COPY[view.name] || CONTENT_V2_COPY.tasks;
  const meta = view.name === "opportunity" && view.id
    ? `<p class="content-v2-meta">المعرّف: ${escapeContentHtml(view.id)}</p>`
    : "";
  return `
    <section class="content-v2-page" aria-label="${escapeContentHtml(copy.title)}">
      <p class="content-v2-kicker">${escapeContentHtml(copy.kicker)}</p>
      <h2 class="content-v2-title">${escapeContentHtml(copy.title)}</h2>
      <p class="content-v2-body">${escapeContentHtml(copy.body)}</p>
      ${meta}
    </section>`;
}
