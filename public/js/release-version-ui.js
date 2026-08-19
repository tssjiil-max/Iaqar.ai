/**
 * Staging release label + one-shot service-worker update prompt.
 * Missing version.json must not break the page or invent a SHA.
 */
import {
  SKIP_WAITING_MESSAGE,
  formatVersionLabel,
  parseReleaseVersion
} from "./release-version-domain.js";

const RELOAD_FLAG = "iaqar-sw-reload";

function resolveEnv(env) {
  const root = env || globalThis;
  return {
    document: root.document,
    fetch: root.fetch ? root.fetch.bind(root) : (typeof fetch === "function" ? fetch : null),
    navigator: root.navigator || {},
    sessionStorage: root.sessionStorage,
    location: root.location || root.window?.location
  };
}

function byId(document, id) {
  return document.getElementById(id);
}

function releaseHost(document) {
  return document.querySelector(".app") || document.body;
}

function ensureVersionEl(document) {
  let el = byId(document, "releaseVersion");
  if (el) return el;
  el = document.createElement("p");
  el.id = "releaseVersion";
  el.className = "release-version";
  el.hidden = true;
  releaseHost(document).appendChild(el);
  return el;
}

function ensureUpdateEl(document, env) {
  let banner = byId(document, "releaseUpdate");
  if (banner) return banner;
  banner = document.createElement("div");
  banner.id = "releaseUpdate";
  banner.className = "release-update";
  banner.hidden = true;
  banner.setAttribute("role", "status");
  const label = document.createElement("span");
  label.textContent = "يتوفر تحديث جديد";
  const button = document.createElement("button");
  button.type = "button";
  button.id = "releaseUpdateBtn";
  button.textContent = "تحديث الآن";
  banner.append(label, button);
  releaseHost(document).appendChild(banner);
  bindUpdateButton(document, env);
  return banner;
}

function showVersion(document, shortSha) {
  const label = formatVersionLabel(shortSha);
  if (!label) return;
  const el = ensureVersionEl(document);
  el.textContent = label;
  el.hidden = false;
}

function showUpdateBanner(document, env) {
  ensureUpdateEl(document, env).hidden = false;
}

function hideUpdateBanner(document) {
  const banner = byId(document, "releaseUpdate");
  if (banner) banner.hidden = true;
}

async function loadVersion(env) {
  if (!env.fetch) return;
  try {
    const response = await env.fetch("/version.json", { cache: "no-store" });
    if (!response.ok) return;
    const parsed = parseReleaseVersion(await response.json());
    if (parsed) showVersion(env.document, parsed.shortSha);
  } catch (_) {
    /* keep the page usable */
  }
}

function reloadOnce(env) {
  try {
    if (env.sessionStorage?.getItem(RELOAD_FLAG) === "1") return;
    env.sessionStorage?.setItem(RELOAD_FLAG, "1");
  } catch (_) {
    /* sessionStorage may be blocked */
  }
  env.location?.reload?.();
}

function clearReloadFlag(env) {
  try { env.sessionStorage?.removeItem(RELOAD_FLAG); } catch (_) { /* ignore */ }
}

async function applyWaitingWorker(env) {
  if (!env.navigator.serviceWorker) return;
  const registration = await env.navigator.serviceWorker.getRegistration();
  const waiting = registration && registration.waiting;
  if (waiting) {
    waiting.postMessage({ type: SKIP_WAITING_MESSAGE });
    return;
  }
  reloadOnce(env);
}

function watchWorker(registration, document, env) {
  if (!registration) return;
  if (registration.waiting && env.navigator.serviceWorker.controller) {
    showUpdateBanner(document, env);
  }
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && env.navigator.serviceWorker.controller) {
        showUpdateBanner(document, env);
      }
    });
  });
  if (typeof registration.update === "function") {
    registration.update().catch(() => {});
  }
}

async function watchServiceWorker(env) {
  if (!env.navigator.serviceWorker) return;
  try {
    if (env.sessionStorage?.getItem(RELOAD_FLAG) === "1") clearReloadFlag(env);
  } catch (_) { /* ignore */ }

  env.navigator.serviceWorker.addEventListener("controllerchange", () => {
    try {
      if (env.sessionStorage?.getItem(RELOAD_FLAG) === "pending") {
        reloadOnce(env);
      }
    } catch (_) {
      reloadOnce(env);
    }
  });

  const existing = await env.navigator.serviceWorker.getRegistration();
  if (existing) {
    watchWorker(existing, env.document, env);
    return;
  }
  const registration = await env.navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
  watchWorker(registration, env.document, env);
}

function bindUpdateButton(document, env) {
  const button = byId(document, "releaseUpdateBtn");
  if (!button || button.dataset.bound === "1") return;
  button.dataset.bound = "1";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { env.sessionStorage?.setItem(RELOAD_FLAG, "pending"); } catch (_) { /* ignore */ }
    hideUpdateBanner(document);
    await applyWaitingWorker(env);
  });
}

export async function bootReleaseVersionUi(envInput) {
  const env = resolveEnv(envInput);
  if (!env.document) return;
  bindUpdateButton(env.document, env);
  await loadVersion(env);
  await watchServiceWorker(env);
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      bootReleaseVersionUi(window).catch(() => {});
    });
  } else {
    bootReleaseVersionUi(window).catch(() => {});
  }
}
