/**
 * «الرجوع إلى بطاقة الصفقة» — remembers which deal the broker left the tasks list for (and which
 * view of the list he was on), so coming back lands on that deal's card instead of the top of the
 * list. Kept for this tab only, and dropped when he moves on to another part of the app.
 */

const KEY = "os.returnDeal";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const TASKS_ROUTE = /^tasks(\?[A-Za-z0-9=&_-]*)?$/;

function read() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = raw.startsWith("{") ? JSON.parse(raw) : { id: raw };
    if (!value || !value.id) return null;
    if (value.at && Date.now() - Number(value.at) > MAX_AGE_MS) return null;
    return value;
  } catch (_) { return null; }
}

export function rememberDeal(journeyId) {
  if (!journeyId) return;
  try {
    const id = String(journeyId);
    const previous = read();
    const here = String(location.hash || "").replace(/^#\/?/, "");
    const from = TASKS_ROUTE.test(here) ? here : previous && previous.id === id && TASKS_ROUTE.test(String(previous.from || "")) ? previous.from : "tasks";
    sessionStorage.setItem(KEY, JSON.stringify({ id, from, at: Date.now() }));
  } catch (_) { /* private mode: the list simply opens at the top */ }
}

export function dealToReturnTo() {
  return read()?.id || "";
}

/** The tasks list as the broker left it (its filter and stage), or the plain list. */
export function tasksRouteToReturnTo() {
  const from = String(read()?.from || "");
  return TASKS_ROUTE.test(from) ? from : "tasks";
}

export function forgetDeal() {
  try { sessionStorage.removeItem(KEY); } catch (_) { /* ignore */ }
}
