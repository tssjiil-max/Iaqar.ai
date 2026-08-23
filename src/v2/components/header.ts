import { V2_PAGE_TITLES, type V2Route } from "../models/routes.js";
import { el } from "../utils/dom.js";

export function renderV2Header(route: V2Route): HTMLElement {
  const header = el("header", { className: "v2-header" });
  const brand = el("p", { className: "v2-header-brand", text: "IAQAR" });
  const title = el("h1", {
    className: "v2-header-title",
    text: V2_PAGE_TITLES[route.name]
  });
  header.append(brand, title);
  return header;
}
