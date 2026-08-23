import { V2_NAV_ITEMS, type V2Route } from "../models/routes.js";
import { el } from "../utils/dom.js";

function activeName(route: V2Route): string {
  return route.name === "opportunity" ? "opportunities" : route.name;
}

export function renderV2Nav(route: V2Route): HTMLElement {
  const nav = el("nav", {
    className: "v2-nav",
    attrs: { "aria-label": "التنقل الرئيسي" }
  });
  const current = activeName(route);
  for (const item of V2_NAV_ITEMS) {
    const link = el("a", {
      className: item.name === current ? "v2-nav-link is-active" : "v2-nav-link",
      text: item.label,
      attrs: {
        href: item.href,
        "data-v2-nav": item.name
      }
    });
    if (item.name === current) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  return nav;
}
