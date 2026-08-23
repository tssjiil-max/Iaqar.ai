import { el } from "../utils/dom.js";
export function renderPlaceholderPage(options) {
    const page = el("section", { className: "v2-page", attrs: { "aria-label": options.title } });
    page.append(el("p", { className: "v2-kicker", text: "IAQAR V2 · المرحلة 1" }), el("h2", { className: "v2-page-title", text: options.title }), el("p", { className: "v2-page-body", text: options.body }));
    if (options.meta) {
        page.append(el("p", { className: "v2-page-meta", text: options.meta }));
    }
    return page;
}
//# sourceMappingURL=placeholder.js.map