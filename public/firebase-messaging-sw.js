function notificationPayload(event) {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = {}; }
  const notification = payload.notification || (payload.data && payload.data.notification) || {};
  const data = payload.data || {};
  return { payload, notification, data };
}

function notificationUrl(data = {}) {
  try { return new URL(data.url || "/", self.location.origin).href; }
  catch (_) { return new URL("/", self.location.origin).href; }
}

self.addEventListener("push", event => {
  const { notification, data } = notificationPayload(event);
  const title = notification.title || "مكاتب عقارية ذكية";
  const icon = notification.icon || data.iconUrl || "/icons/icon-192.png";
  const options = {
    body: notification.body || "توجد مطابقة عقارية أو متابعة جديدة",
    icon,
    badge: notification.badge || "/icons/icon-192.png",
    dir: "rtl",
    lang: "ar",
    data: {
      url: notificationUrl(data),
      officeId: data.officeId || "",
      type: data.type || "",
      recordId: data.recordId || "",
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
        payload: { notification: { title, body: options.body }, data: { ...data, url: options.data.url } }
      }));
      return undefined;
    }
    return self.registration.showNotification(title, options);
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = notificationUrl(event.notification.data || {});
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

const IAQAR_CACHE = "iaqar-shell-phase9a-v7";
const IAQAR_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/share-target.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/default-office.png",
  // runtime-config.js is network-only (staging/prod Worker routing must not stale-cache).
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
  if (url.pathname.endsWith("/runtime-config.js")) {
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
