#!/usr/bin/env node
/**
 * Reads `wrangler secret list --format json` from stdin and answers whether one secret NAME is present.
 * Only names are read; Wrangler never returns secret values. Nothing is printed except the verdict.
 *
 * Usage: npx wrangler secret list --env staging --format json | node scripts/staging-secret-names.mjs GEMINI_API_KEY
 * Exit: 0 = present, 1 = absent, 2 = the list could not be read (callers must treat this as "cannot prove absent").
 */
export function secretNames(text) {
  const raw = String(text ?? "");
  const end = raw.lastIndexOf("]");
  // Wrangler may print warnings such as "▲ [WARNING] …" before the JSON; try each "[" until a list of names parses.
  for (let start = raw.indexOf("["); start >= 0 && start < end; start = raw.indexOf("[", start + 1)) {
    let list;
    try { list = JSON.parse(raw.slice(start, end + 1)); } catch { continue; }
    if (Array.isArray(list) && list.every((item) => item && typeof item.name === "string")) return list.map((item) => item.name);
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2];
  if (!name || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
    console.error("staging-secret-names: a secret name is required");
    process.exit(2);
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const names = secretNames(Buffer.concat(chunks).toString("utf8"));
  if (!names) {
    console.error("staging-secret-names: could not read the Worker secret names");
    process.exit(2);
  }
  console.log(`${name}: ${names.includes(name) ? "present" : "absent"}`);
  process.exit(names.includes(name) ? 0 : 1);
}
