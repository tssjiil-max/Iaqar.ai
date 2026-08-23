export function el(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className)
        node.className = options.className;
    if (options.text)
        node.textContent = options.text;
    if (options.attrs) {
        for (const [key, value] of Object.entries(options.attrs)) {
            node.setAttribute(key, value);
        }
    }
    return node;
}
export function clearNode(node) {
    node.replaceChildren();
}
//# sourceMappingURL=dom.js.map