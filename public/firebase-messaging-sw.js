function notificationPayload(event) {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = {}; }
  const notification = payload.notification || (payload.data && payload.data.notification) || {};
  const data = payload.data || {};
  return { payload, notification, data };
}

function safeId(value) {
  return String(value || "").trim();
}

function buildNotificationRelativeUrl(data = {}) {
  const type = safeId(data.type || data.notificationType).toLowerCase();
  const recordId = safeId(data.recordId || data.matchId || data.dealId);
  const entityType = safeId(data.entityType).toLowerCase();
  const entityId = safeId(data.entityId || recordId);
  const officeId = safeId(data.officeId);
  const targetPath = safeId(data.targetPath || data.actionUrl);
  const params = new URLSearchParams();

  if (targetPath.startsWith("/")) return targetPath;

  if (officeId === "platform") params.set("office", "platform");
  else if (officeId) params.set("officeId", officeId);

  if (type === "deal" || data.dealId) {
    params.set("openDeal", safeId(data.dealId) || recordId);
  } else if (type === "broker_application") {
    params.set("adminApplications", "1");
    if (recordId) params.set("openBrokerApplication", recordId);
  } else if (type === "message" || type === "conversation") {
    if (recordId) params.set("openMessage", recordId);
    else params.set("openNotifications", "1");
  } else if (entityType === "opportunity" || entityId.startsWith("opp_") || recordId.startsWith("opp_")) {
    params.set("openOpportunity", entityId.startsWith("opp_") ? entityId : recordId);
  } else if (
    entityType === "cooperation"
    || type.includes("cooperation")
    || recordId.startsWith("coop_")
  ) {
    if (recordId) params.set("openCooperation", recordId);
    else params.set("openNotifications", "1");
  } else if (
    recordId.startsWith("op_")
    || type === "missing_data"
    || type === "operation"
    || type === "followup"
    || type === "client_request"
    || type === "owner_offer"
    || type === "system"
  ) {
    params.set("openOperation", recordId);
  } else if (type === "match" && recordId && !recordId.startsWith("op_")) {
    params.set("openMatch", recordId);
  } else if (recordId) {
    params.set("openOperation", recordId);
  } else {
    params.set("openNotifications", "1");
  }

  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

function notificationUrl(data = {}) {
  if (data.url && String(data.url).startsWith("http")) {
    try { return new URL(data.url).pathname + new URL(data.url).search; }
    catch (_) { /* fall through */ }
  }
  if (data.url && String(data.url).startsWith("/")) return data.url;
  const relative = buildNotificationRelativeUrl(data);
  try { return new URL(relative, self.location.origin).href; }
  catch (_) { return new URL("/", self.location.origin).href; }
}

self.addEventListener("push", event => {
  const { notification, data } = notificationPayload(event);
  const title = notification.title || "مكاتب عقارية ذكية";
  const icon = notification.icon || data.iconUrl || "/icons/icon-192.png";
  const relativeLink = buildNotificationRelativeUrl(data);
  const absoluteLink = notificationUrl({ ...data, url: relativeLink });
  const options = {
    body: notification.body || "توجد مطابقة عقارية أو متابعة جديدة",
    icon,
    badge: notification.badge || "/icons/icon-192.png",
    dir: "rtl",
    lang: "ar",
    data: {
      url: absoluteLink,
      relativeUrl: relativeLink,
      officeId: data.officeId || "",
      type: data.type || "",
      recordId: data.recordId || data.matchId || data.dealId || "",
      matchId: data.matchId || "",
      dealId: data.dealId || "",
      deliveryId: data.deliveryId || ""
    },
    tag: notification.tag || data.recordId || data.matchId || data.dealId || data.deliveryId || "iaqar-workflow",
    renotify: notification.renotify !== false,
    requireInteraction: data.type === "match" && String(notification.body || "").includes("أفضل فرصة")
  };
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const visibleClients = list.filter(client => client.visibilityState === "visible" || client.focused === true);
    if (visibleClients.length) {
      visibleClients.forEach(client => client.postMessage({
        type: "IAQAR_FCM_FOREGROUND",
        payload: { notification: { title, body: options.body }, data: { ...data, url: relativeLink } }
      }));
      return undefined;
    }
    return self.registration.showNotification(title, options);
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = notificationUrl(data);
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const sameOrigin = list.find(client => {
      try { return new URL(client.url).origin === self.location.origin; }
      catch (_) { return false; }
    });
    if (sameOrigin) {
      return sameOrigin.navigate(targetUrl).then(client => client && "focus" in client ? client.focus() : client);
    }
    return clients.openWindow(targetUrl);
  }));
});

const IAQAR_CACHE_PREFIX = "iaqar-shell-";
const IAQAR_CACHE_FAMILY = "iaqar-";
const IAQAR_SKIP_WAITING = "IAQAR_SKIP_WAITING";
const IAQAR_NETWORK_ONLY = [
  "/js/runtime-config.js",
  "/js/gemini-voice-intake-ui.js",
  "/js/gemini-voice-intake-domain.js",
  "/js/opportunity-import-advert-ui.js",
  "/js/opportunity-import-advert-domain.js",
  "/js/release-version-ui.js",
  "/js/release-version-domain.js"
];
const IAQAR_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/share-target.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-192-maskable.png",
  "/icons/icon-512-maskable.png",
  "/icons/favicon-32.png",
  "/icons/favicon-16.png",
  "/icons/default-office.png",
  "/js/notification-navigation.js",
  "/js/access-gate.js",
  "/js/firebase-office.js",
  "/js/fcm-fid.js",
  "/js/office-settings.js",
  "/js/add-opportunity.js",
  "/js/opportunity-bank.js",
  "/js/opportunity-bank-workspace-ui.js",
  "/js/opportunity-details-ui.js",
  "/js/opportunity-listing-card-ui.js",
  "/js/opportunity-listing-normalize.js",
  "/js/opportunity-field-completion-domain.js",
  "/js/ops-task-card-domain.js",
  "/js/qrcode.js",
  "/js/whatsapp-office.js",
  "/js/operations-domain-bridge.js",
  "/js/operations-center-bridge.js",
  "/js/operations-center-domain.js",
  "/js/ops-card-badge-domain.js",
  "/js/daily-tasks-domain.js",
  "/js/messaging-domain-bridge.js",
  "/js/workflow-office.js",
  "/js/display-sanitize-domain.js",
  "/js/arabic-field-suggest.js",
  "/js/opportunity-card-domain.js",
  "/js/header-scroll.js"
];

function isHtmlPath(pathname) {
  return pathname === "/" || pathname === "/index.html" || pathname.endsWith(".html");
}

function isVersionPath(pathname) {
  return pathname === "/version.json";
}

function isJavaScriptPath(pathname) {
  return pathname.endsWith(".js");
}

function isLongCacheAssetPath(pathname) {
  if (pathname.startsWith("/icons/") || pathname.startsWith("/fonts/")) return true;
  return /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf)$/i.test(pathname);
}

async function readRelease() {
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    const shortSha = String(data && data.shortSha || "").trim().toLowerCase();
    if (!/^[0-9a-f]{7,40}$/i.test(shortSha)) return null;
    return { shortSha };
  } catch (_) {
    return null;
  }
}

function cacheNameFor(shortSha) {
  const sha = String(shortSha || "").trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return `${IAQAR_CACHE_PREFIX}pending`;
  return `${IAQAR_CACHE_PREFIX}${sha}`;
}

async function currentCacheName() {
  const release = await readRelease();
  return cacheNameFor(release && release.shortSha);
}

async function precacheRelease() {
  const name = await currentCacheName();
  const cache = await caches.open(name);
  await cache.addAll(IAQAR_SHELL).catch(() => {});
  return name;
}

async function networkFirst(request, cacheMode, cacheName) {
  try {
    const response = await fetch(request, cacheMode ? { cache: cacheMode } : undefined);
    if (response && response.ok && cacheName) {
      const copy = response.clone();
      caches.open(cacheName).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    return cached || caches.match("/");
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && cacheName) {
    const copy = response.clone();
    caches.open(cacheName).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await precacheRelease();
    if (!self.registration.active) {
      await self.skipWaiting();
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const current = await currentCacheName();
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(IAQAR_CACHE_FAMILY) && key !== current)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const type = typeof data === "string" ? data : data.type;
  if (type === IAQAR_SKIP_WAITING) {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cacheName = await currentCacheName();
    if (isVersionPath(url.pathname)
      || url.pathname.endsWith("/runtime-config.js")
      || IAQAR_NETWORK_ONLY.includes(url.pathname)) {
      return fetch(event.request, { cache: "no-store" });
    }
    if (isHtmlPath(url.pathname)) {
      return networkFirst(event.request, "no-store", cacheName);
    }
    if (isLongCacheAssetPath(url.pathname)) {
      return cacheFirst(event.request, cacheName);
    }
    if (isJavaScriptPath(url.pathname)) {
      return networkFirst(event.request, "no-cache", cacheName);
    }
    return networkFirst(event.request, "no-cache", cacheName);
  })());
});
