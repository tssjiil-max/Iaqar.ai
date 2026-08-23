export function normalizeDocumentId(value: string): string {
  const id = value.trim();
  if (!id) return "";
  if (id.includes("/") || id.includes("\\") || id.includes("..")) return "";
  if (id.length > 128) return "";
  return id;
}
