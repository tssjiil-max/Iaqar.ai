/**
 * Lightweight verification of neighborhood duplicate + routing rules.
 * Run: node scripts/verify-logic.mjs
 */

function normalizeNeighborhood(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function fingerprint(message) {
  if (!message.listing?.neighborhood) return null;
  return [
    normalizeNeighborhood(message.listing.neighborhood),
    message.listing.intent,
    (message.listing.propertyType ?? "").trim().toLowerCase(),
  ].join("|");
}

function findDuplicate(message, catalog) {
  const fp = fingerprint(message);
  if (!fp) return undefined;
  return catalog.find((existing) => {
    if (existing.id === message.id) return false;
    if (existing.status === "duplicate_closed") return false;
    return fingerprint(existing) === fp;
  });
}

function suggestRoute(message) {
  if (message.from.role === "agent") return "owner";
  return "agent";
}

function cooperateMedia(mediaKind, current) {
  if (mediaKind === "image" || mediaKind === "location") {
    return current === "website" ? "whatsapp" : "website";
  }
  if (mediaKind === "audio") return "whatsapp";
  if (mediaKind === "document") return "sms";
  return current;
}

const existing = {
  id: "a",
  status: "routed",
  listing: { neighborhood: "النرجس", intent: "sale", propertyType: "شقة" },
  from: { role: "owner" },
};

const dup = {
  id: "b",
  status: "new",
  listing: { neighborhood: " النرجس ", intent: "sale", propertyType: "شقة" },
  from: { role: "customer" },
};

const unique = {
  id: "c",
  status: "new",
  listing: { neighborhood: "الملقا", intent: "rent", propertyType: "فيلا" },
  from: { role: "agent" },
  mediaKind: "audio",
  channel: "instagram",
};

const checks = [
  ["detects neighborhood duplicate", Boolean(findDuplicate(dup, [existing]))],
  ["allows unique neighborhood", !findDuplicate(unique, [existing])],
  ["routes customer to agent", suggestRoute(dup) === "agent"],
  ["routes agent to owner", suggestRoute(unique) === "owner"],
  ["audio cooperates to whatsapp", cooperateMedia("audio", "instagram") === "whatsapp"],
  ["image cooperates to website", cooperateMedia("image", "whatsapp") === "website"],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    failed += 1;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`OK: ${name}`);
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log(`All ${checks.length} checks passed.`);
