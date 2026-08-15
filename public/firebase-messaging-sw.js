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

const IAQAR_CACHE = "iaqar-shell-phase10-v1";
const IAQAR_NETWORK_ONLY = [
  "/js/runtime-config.js",
  "/js/gemini-voice-intake-ui.js",
  "/js/gemini-voice-intake-domain.js"
];
const IAQAR_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/share-target.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/default-office.png",
  // runtime-config.js is network-only (staging/prod Worker routing must not stale-cache).
  "/js/notification-navigation.js",
  "/js/access-gate.js",
  "/js/firebase-office.js",
  "/js/fcm-fid.js",
  "/js/office-settings.js",
  "/js/add-opportunity.js",
  "/js/opportunity-bank.js",
  "/js/qrcode.js",
  "/js/whatsapp-office.js",
  "/js/operations-domain-bridge.js",
  "/js/messaging-domain-bridge.js",
  "/js/workflow-office.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(IAQAR_CACHE).then(cache => cache.addAll(IAQAR_SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== IAQAR_CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Always network for deployment routing — never serve a stale Worker base.
  if (url.pathname.endsWith("/runtime-config.js")
    || IAQAR_NETWORK_ONLY.includes(url.pathname)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }
  event.respondWith(fetch(event.request).then(response => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(IAQAR_CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
    }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match("/"))));
});
