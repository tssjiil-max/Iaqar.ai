import { type V2Route } from "../models/routes.js";
import { normalizeDocumentId } from "../utils/ids.js";

function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

export function parseV2Hash(hash = ""): V2Route {
  const path = String(hash || "").replace(/^#/, "").replace(/^\/+/, "");
  const [rawHead = "", ...rest] = path.split("/").filter(Boolean);
  const head = rawHead.toLowerCase();

  if (!head || head === "home") return { name: "opportunities" };
  if (head === "opportunities" && rest[0]) {
    const id = normalizeDocumentId(decodeSegment(rest[0]));
    if (id) return { name: "opportunity", id };
    return { name: "opportunities" };
  }
  if (head === "opportunities") return { name: "opportunities" };
  if (head === "tasks") return { name: "tasks" };
  if (head === "matches") return { name: "matches" };
  if (head === "community") return { name: "community" };
  if (head === "agreements") return { name: "agreements" };
  return { name: "opportunities" };
}

export function buildV2Hash(route: V2Route): string {
  if (route.name === "opportunity") {
    return `#/opportunities/${encodeURIComponent(route.id)}`;
  }
  return `#/${route.name}`;
}

export function isSameV2Route(left: V2Route, right: V2Route): boolean {
  if (left.name !== right.name) return false;
  if (left.name === "opportunity" && right.name === "opportunity") {
    return left.id === right.id;
  }
  return true;
}
