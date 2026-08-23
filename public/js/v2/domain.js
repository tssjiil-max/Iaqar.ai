/**
 * Content-area views only. No V2 header or V2 navigation.
 * Copied to public/js/v2/ — imports resolve from there.
 */

import { parseOpportunityIdFromHash } from "../opportunity-navigation-domain.js";

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
  const name = escapeContentHtml(view?.name || "tasks");
  const idAttr = view?.id ? ` data-opportunity-id="${escapeContentHtml(view.id)}"` : "";
  return `<section class="content-v2-surface" data-content-view="${name}"${idAttr} aria-label="منطقة المحتوى"></section>`;
}
