/**
 * Staging release identity and cache policy.
 * Pure logic shared by the page, tests, and deploy guards.
 */

import { isBrandIconPath } from "./platform-brand-domain.js";

export { isBrandIconPath };

export const REQUIRED_STAGING_BRANCH = "cursor/opportunity-lifecycle-transfer-ed07";
export const APPROVED_STAGING_URL = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
export const FORBIDDEN_STAGING_URL = `https://${["iaqar-ai-staging", "web.app"].join(".")}`;
export const STAGING_FIREBASE_PROJECT = "iaqar-ai-staging";
export const STAGING_CHANNEL = "staging";
export const IAQAR_CACHE_PREFIX = "iaqar-shell-";
export const IAQAR_CACHE_FAMILY = "iaqar-";
export const SKIP_WAITING_MESSAGE = "IAQAR_SKIP_WAITING";

const SHORT_SHA_RE = /^[0-9a-f]{7,40}$/i;
const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

export function isValidShortSha(value) {
  return SHORT_SHA_RE.test(String(value || "").trim());
}

export function isValidFullSha(value) {
  return FULL_SHA_RE.test(String(value || "").trim());
}

export function cacheNameFor(shortSha) {
  const sha = String(shortSha || "").trim().toLowerCase();
  if (!isValidShortSha(sha)) return `${IAQAR_CACHE_PREFIX}pending`;
  return `${IAQAR_CACHE_PREFIX}${sha}`;
}

export function isIaqarCacheName(name) {
  return String(name || "").startsWith(IAQAR_CACHE_FAMILY);
}

export function cachesToDelete(keys, currentName) {
  return (Array.isArray(keys) ? keys : []).filter((key) => (
    isIaqarCacheName(key) && key !== currentName
  ));
}

export function buildVersionPayload({ fullSha, shortSha, branch, deployedAt, channel = STAGING_CHANNEL }) {
  const full = String(fullSha || "").trim().toLowerCase();
  const short = String(shortSha || "").trim().toLowerCase() || full.slice(0, 7);
  if (!isValidFullSha(full) || !isValidShortSha(short)) {
    throw new Error("version payload requires git SHAs");
  }
  return {
    shortSha: short,
    fullSha: full,
    branch: String(branch || "").trim(),
    channel: String(channel || STAGING_CHANNEL).trim() || STAGING_CHANNEL,
    deployedAt: String(deployedAt || "")
  };
}

export function parseReleaseVersion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const shortSha = String(raw.shortSha || "").trim().toLowerCase();
  const fullSha = String(raw.fullSha || "").trim().toLowerCase();
  if (!isValidShortSha(shortSha)) return null;
  if (fullSha && !isValidFullSha(fullSha)) return null;
  return {
    shortSha,
    fullSha,
    branch: String(raw.branch || ""),
    channel: String(raw.channel || ""),
    deployedAt: String(raw.deployedAt || "")
  };
}

export function formatVersionLabel(shortSha) {
  const sha = String(shortSha || "").trim().toLowerCase();
  if (!isValidShortSha(sha)) return "";
  return `نسخة: ${sha}`;
}

export function assertReleaseMatch(published, localFullSha) {
  const parsed = parseReleaseVersion(published);
  const local = String(localFullSha || "").trim().toLowerCase();
  if (!parsed || !parsed.fullSha) {
    throw new Error("published version.json is missing a valid fullSha");
  }
  if (!isValidFullSha(local)) {
    throw new Error("local commit SHA is invalid");
  }
  if (parsed.fullSha !== local) {
    throw new Error(`published fullSha ${parsed.fullSha} does not match local ${local}`);
  }
  return true;
}

export function isHtmlPath(pathname) {
  const path = String(pathname || "");
  return path === "/" || path === "/index.html" || path.endsWith(".html");
}

export function isVersionPath(pathname) {
  return String(pathname || "") === "/version.json";
}

export function isJavaScriptPath(pathname) {
  return String(pathname || "").endsWith(".js");
}

export function isLongCacheAssetPath(pathname) {
  const path = String(pathname || "");
  if (isBrandIconPath(path)) return false;
  if (path.startsWith("/icons/") || path.startsWith("/fonts/")) return true;
  return /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf)$/i.test(path);
}

export function fetchStrategyFor(pathname) {
  if (isVersionPath(pathname) || isHtmlPath(pathname)) return "network-first-nostore";
  if (isLongCacheAssetPath(pathname)) return "cache-first";
  if (isJavaScriptPath(pathname)) return "network-first";
  return "network-first";
}

export function assertSafeToDeployStaging({
  branch,
  porcelain,
  localSha,
  remoteSha,
  firebaseRc,
  deployTarget = "staging",
  extraArgs = []
} = {}) {
  const errors = [];
  if (String(branch || "") !== REQUIRED_STAGING_BRANCH) {
    errors.push("branch");
  }
  if (String(porcelain || "").trim()) {
    errors.push("dirty-tree");
  }
  if (!isValidFullSha(localSha) || String(localSha) !== String(remoteSha)) {
    errors.push("origin-mismatch");
  }
  if (!firebaseRc || firebaseRc.projects?.staging !== STAGING_FIREBASE_PROJECT) {
    errors.push("firebase-target");
  }
  if (String(deployTarget || "staging") !== "staging") {
    errors.push("deploy-target");
  }
  const args = Array.isArray(extraArgs) ? extraArgs : [];
  if (args.some((arg) => arg === "--production" || arg === "production")) {
    errors.push("production-flag");
  }
  return { ok: errors.length === 0, errors };
}

export function scriptForbidsProductionDeploy(source) {
  const text = String(source || "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed
        && !trimmed.startsWith("#")
        && !trimmed.startsWith("echo ")
        && !trimmed.startsWith("Write-Host");
    })
    .join("\n");
  const wrangler = [...text.matchAll(/wrangler deploy(?:\s+--env\s+(\S+))?/g)];
  if (wrangler.some((match) => match[1] !== "staging")) return false;
  if (/firebase deploy --only hosting/.test(text)) return false;
  if (/--project\s+["']?aqar-b5d76/.test(text)) return false;
  if (/^\s*(?:bash\s+)?(?:\.\/)?deploy-all(?:\.ps1|\.cmd|\.sh)?\b/m.test(text)) return false;
  return true;
}
