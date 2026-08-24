/**
 * Auto-hides the existing office license card while scrolling daily tasks.
 * Mobile only. No hide/show button and no chevron.
 */

const ACTIVE_CLASS = "cv2-tasks-office-smart";
const HIDDEN_CLASS = "cv2-office-hidden";
const MOBILE_MQ = "(max-width: 600px)";
const TOP_SHOW_Y = 8;
const DIRECTION_DELTA = 6;

const bound = new WeakMap();

function officeLicenseCard(rootDocument = document) {
  return rootDocument.querySelector(".app > section.card.license")
    || rootDocument.querySelector("section.card.license");
}

function htmlRoot(rootDocument = document) {
  return rootDocument.documentElement;
}

function isMobile(rootWindow, mq) {
  if (mq && typeof mq.matches === "boolean") return mq.matches;
  return (rootWindow.innerWidth || 0) <= 600;
}

function currentScrollY(rootWindow, rootDocument) {
  return rootWindow.scrollY
    || rootDocument.documentElement?.scrollTop
    || rootDocument.body?.scrollTop
    || 0;
}

function measureNaturalHeight(html, card) {
  const wasHidden = html.classList.contains(HIDDEN_CLASS);
  const previous = card.style.maxHeight;
  html.classList.remove(HIDDEN_CLASS);
  card.style.maxHeight = "none";
  const height = card.scrollHeight;
  if (wasHidden) html.classList.add(HIDDEN_CLASS);
  card.style.maxHeight = previous;
  return height;
}

function hideCard(html, card) {
  if (html.classList.contains(HIDDEN_CLASS)) return;
  card.style.maxHeight = `${card.scrollHeight}px`;
  void card.offsetHeight;
  html.classList.add(HIDDEN_CLASS);
  card.style.maxHeight = "0px";
}

function showCard(html, card) {
  if (!html.classList.contains(HIDDEN_CLASS)) return;
  const height = measureNaturalHeight(html, card);
  card.style.maxHeight = "0px";
  void card.offsetHeight;
  html.classList.remove(HIDDEN_CLASS);
  card.style.maxHeight = `${height}px`;
}

export function setupOfficeSmartHide(rootDocument = document, rootWindow = window) {
  teardownOfficeSmartHide(rootDocument, rootWindow);
  const html = htmlRoot(rootDocument);
  const card = officeLicenseCard(rootDocument);
  html.classList.add(ACTIVE_CLASS);
  if (!card) return;

  const mq = rootWindow.matchMedia?.(MOBILE_MQ) || null;
  const raf = typeof rootWindow.requestAnimationFrame === "function"
    ? rootWindow.requestAnimationFrame.bind(rootWindow)
    : (fn) => fn();
  let lastY = currentScrollY(rootWindow, rootDocument);
  let ticking = false;

  const syncMaxHeight = () => {
    if (html.classList.contains(HIDDEN_CLASS)) return;
    card.style.maxHeight = `${card.scrollHeight}px`;
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    raf(() => {
      ticking = false;
      if (!isMobile(rootWindow, mq)) {
        html.classList.remove(HIDDEN_CLASS);
        card.style.maxHeight = "";
        return;
      }
      const y = currentScrollY(rootWindow, rootDocument);
      if (y <= TOP_SHOW_Y) {
        showCard(html, card);
        lastY = y;
        return;
      }
      const delta = y - lastY;
      if (Math.abs(delta) < DIRECTION_DELTA) return;
      if (delta > 0) hideCard(html, card);
      else showCard(html, card);
      lastY = y;
    });
  };

  const onResize = () => {
    if (!isMobile(rootWindow, mq)) {
      html.classList.remove(HIDDEN_CLASS);
      card.style.maxHeight = "";
      return;
    }
    syncMaxHeight();
  };

  const onTransitionEnd = (event) => {
    if (event.target !== card || event.propertyName !== "max-height") return;
    if (!html.classList.contains(HIDDEN_CLASS)) card.style.maxHeight = "none";
  };

  syncMaxHeight();
  rootWindow.addEventListener("scroll", onScroll, { passive: true });
  rootWindow.addEventListener("resize", onResize);
  card.addEventListener("transitionend", onTransitionEnd);
  mq?.addEventListener?.("change", onResize);
  bound.set(rootDocument, { card, html, onScroll, onResize, onTransitionEnd, mq, rootWindow });
}

export function teardownOfficeSmartHide(rootDocument = document, rootWindow = window) {
  const html = htmlRoot(rootDocument);
  const existing = bound.get(rootDocument);
  const card = existing?.card || officeLicenseCard(rootDocument);
  const win = existing?.rootWindow || rootWindow;
  if (existing) {
    win.removeEventListener("scroll", existing.onScroll);
    win.removeEventListener("resize", existing.onResize);
    existing.card?.removeEventListener("transitionend", existing.onTransitionEnd);
    existing.mq?.removeEventListener?.("change", existing.onResize);
    bound.delete(rootDocument);
  }
  html.classList.remove(ACTIVE_CLASS, HIDDEN_CLASS);
  if (card) card.style.maxHeight = "";
}

export function isOfficeSmartHideActive(rootDocument = document) {
  return htmlRoot(rootDocument).classList.contains(ACTIVE_CLASS);
}
