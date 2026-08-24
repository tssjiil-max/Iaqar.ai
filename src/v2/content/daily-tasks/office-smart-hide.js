/**
 * Auto-hides the existing office license card while scrolling daily tasks.
 * Mobile only. No hide/show button and no chevron.
 */

const ACTIVE_CLASS = "cv2-tasks-office-smart";
const HIDDEN_CLASS = "cv2-office-hidden";
const MOBILE_MQ = "(max-width: 600px)";
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

function hideCard(html, card, lock) {
  if (html.classList.contains(HIDDEN_CLASS)) return;
  if (lock) lock.rewindBudget = card.scrollHeight;
  card.style.maxHeight = `${card.scrollHeight}px`;
  void card.offsetHeight;
  html.classList.add(HIDDEN_CLASS);
  card.style.maxHeight = "0px";
}

function showCard(html, card, lock) {
  if (!html.classList.contains(HIDDEN_CLASS)) return;
  if (lock) lock.rewindBudget = 0;
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
  let lastTouchY = null;
  const lock = { rewindBudget: 0 };

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
      const delta = y - lastY;
      lastY = y;
      if (delta < 0 && lock.rewindBudget > 0) {
        lock.rewindBudget = Math.max(0, lock.rewindBudget + delta);
        return;
      }
      if (Math.abs(delta) < DIRECTION_DELTA) return;
      if (delta > 0) hideCard(html, card, lock);
      else showCard(html, card, lock);
    });
  };

  const onTouchStart = (event) => {
    lastTouchY = event.touches?.[0]?.clientY ?? null;
  };

  const onTouchMove = (event) => {
    if (!isMobile(rootWindow, mq)) return;
    const pointY = event.touches?.[0]?.clientY;
    if (lastTouchY == null || pointY == null) return;
    const dy = pointY - lastTouchY;
    lastTouchY = pointY;
    if (dy < -10) hideCard(html, card, lock);
    else if (dy > 10) showCard(html, card, lock);
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
  rootWindow.addEventListener("touchstart", onTouchStart, { passive: true });
  rootWindow.addEventListener("touchmove", onTouchMove, { passive: true });
  card.addEventListener("transitionend", onTransitionEnd);
  mq?.addEventListener?.("change", onResize);
  bound.set(rootDocument, { card, html, onScroll, onResize, onTouchStart, onTouchMove, onTransitionEnd, mq, rootWindow });
}

export function teardownOfficeSmartHide(rootDocument = document, rootWindow = window) {
  const html = htmlRoot(rootDocument);
  const existing = bound.get(rootDocument);
  const card = existing?.card || officeLicenseCard(rootDocument);
  const win = existing?.rootWindow || rootWindow;
  if (existing) {
    win.removeEventListener("scroll", existing.onScroll);
    win.removeEventListener("resize", existing.onResize);
    win.removeEventListener("touchstart", existing.onTouchStart);
    win.removeEventListener("touchmove", existing.onTouchMove);
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
