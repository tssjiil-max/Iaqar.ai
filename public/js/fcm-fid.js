(() => {
  "use strict";

  const APP_NAME = "iaqar-fcm-fid";
  const FIREBASE_VERSION = "12.16.0";

  window.IAQAR_FCM_READY = (async () => {
    const appModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
    const messagingModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-messaging.js`);

    if (!window.firebase || typeof window.firebase.app !== "function" || !window.firebase.apps || !window.firebase.apps.length) {
      throw new Error("Firebase compat app is not initialized");
    }

    const options = window.firebase.app().options;
    let app = appModule.getApps().find(item => item.name === APP_NAME);
    if (!app) app = appModule.initializeApp(options, APP_NAME);

    const supported = await messagingModule.isSupported().catch(() => false);
    if (!supported) return null;

    const messaging = messagingModule.getMessaging(app);
    let currentFid = "";
    let pendingResolvers = [];
    const foregroundListeners = new Set();

    const resolvePending = fid => {
      currentFid = String(fid || "").trim();
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      resolvers.forEach(resolve => resolve(currentFid));
      window.dispatchEvent(new CustomEvent("iaqar:fcm-registered", { detail: { fid: currentFid } }));
    };

    messagingModule.onRegistered(messaging, resolvePending);
    messagingModule.onUnregistered(messaging, fid => {
      if (!fid || fid === currentFid) currentFid = "";
      window.dispatchEvent(new CustomEvent("iaqar:fcm-unregistered", { detail: { fid: String(fid || "") } }));
    });
    messagingModule.onMessage(messaging, payload => {
      foregroundListeners.forEach(listener => {
        try { listener(payload); } catch (error) { console.warn("[iaqar] FCM foreground listener", error); }
      });
    });

    async function register(options = {}) {
      const registerOptions = { serviceWorkerRegistration: options.serviceWorkerRegistration };
      if (options.vapidKey) registerOptions.vapidKey = options.vapidKey;
      await messagingModule.register(messaging, registerOptions);
      if (currentFid) return currentFid;
      return new Promise((resolve, reject) => {
        let wrappedResolve;
        const timer = setTimeout(() => {
          pendingResolvers = pendingResolvers.filter(item => item !== wrappedResolve);
          reject(new Error("Timed out waiting for Firebase Installation ID"));
        }, 15000);
        wrappedResolve = fid => {
          clearTimeout(timer);
          resolve(fid);
        };
        pendingResolvers.push(wrappedResolve);
      });
    }

    return Object.freeze({
      mode: "fid",
      register,
      currentId: () => currentFid,
      onMessage(listener) {
        foregroundListeners.add(listener);
        return () => foregroundListeners.delete(listener);
      }
    });
  })().catch(error => {
    console.warn("[iaqar] FID messaging unavailable; legacy FCM token fallback will be used", error);
    return null;
  });
})();
