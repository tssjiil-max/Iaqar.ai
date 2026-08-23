export function normalizeDocumentId(value) {
    const id = value.trim();
    if (!id)
        return "";
    if (id.includes("/") || id.includes("\\") || id.includes(".."))
        return "";
    if (id.length > 128)
        return "";
    return id;
}
//# sourceMappingURL=ids.js.map