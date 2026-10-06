/** Hash navigation shared by all views (kept separate to avoid import cycles). */

let rerender = () => {};
let depth = 0;

export function setRenderer(fn) {
  rerender = fn;
}

/** Called by the app on every in-app hashchange. */
export function noteNavigation() {
  depth += 1;
}

export function go(path) {
  const next = `#/${String(path || "").replace(/^#?\/?/, "")}`;
  if (location.hash === next) rerender();
  else location.hash = next;
}

/** Move within the same page (a tab of it) without adding a history entry, so «رجوع» leaves the page in one press. */
export function replace(path) {
  const next = `#/${String(path || "").replace(/^#?\/?/, "")}`;
  if (location.hash !== next) history.replaceState(null, "", next);
  rerender();
}

/** Back within the app when possible, otherwise to a sensible parent page. */
export function back(fallback = "tasks") {
  if (depth > 0) {
    depth -= 2; // the history.back() below triggers another hashchange (+1)
    history.back();
  } else {
    go(fallback);
  }
}

export function refresh() {
  rerender();
}
