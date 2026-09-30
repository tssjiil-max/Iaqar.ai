/**
 * Office OS entry point.
 *   /o/<slug>, /m/<slug>, ?office=<id>&view=public → public office page (no account)
 *   everything else                                → «دخول المكتب» + office app
 * Office app routes (hash): #/office (default) · #/tasks · #/task/<id> · #/repo · #/record/<id> · #/record/new ·
 *   #/record/<id>/edit · #/review/<matchId> · #/journey/<id> · #/session/<journeyId> · #/settings
 */

import { h, clear, append } from "./core/dom.js";
import { api, firebaseReady } from "./core/runtime.js";
import { ACCESS_MESSAGES, loadOfficeAccess, preferredOfficeId, session, signOutOffice, waitForAuth } from "./core/session.js";
import { startOfficeData, state, subscribe } from "./core/state.js";
import { toast } from "./core/ui.js";
import { renderLogin } from "./views/login.js";
import { renderShellHeader, renderBottomNav } from "./views/shell.js";
import { renderOffice, renderTaskDetail } from "./views/reference-layout.js";
import { renderTasks } from "./views/tasks.js";
import { renderRepository } from "./views/repository.js";
import { renderRecordDetail } from "./views/record-detail.js";
import { renderRecordForm } from "./views/record-form.js";
import { renderReview } from "./views/review.js";
import { renderWorkspace } from "./views/workspace.js";
import { renderSession } from "./views/session-view.js";
import { renderSettings } from "./views/settings.js";
import { renderPublicOffice, publicOfficeTarget } from "./views/public-office.js";
import { go, noteNavigation, setRenderer } from "./core/nav.js";

const root = document.getElementById("app");
let cleanup = null;

function parseHash() {
  const raw = String(location.hash || "").replace(/^#\/?/, "");
  const [pathPart, queryPart = ""] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  return { parts, query: new URLSearchParams(queryPart) };
}

function view() {
  const { parts, query } = parseHash();
  const [section = "office", id = "", sub = ""] = parts;
  if (section === "office") return { name: "office", main: true, run: renderOffice };
  if (section === "task" && id) return { name: "task", run: (el) => renderTaskDetail(el, { taskId: id }) };
  if (section === "repo") return { name: "repo", main: true, run: (el) => renderRepository(el, { query }) };
  if (section === "record" && id === "new") return { name: "form", run: (el) => renderRecordForm(el, { kind: query.get("kind") || "OFFER" }) };
  if (section === "record" && sub === "edit") return { name: "form", run: (el) => renderRecordForm(el, { recordId: id }) };
  if (section === "record" && id) return { name: "record", run: (el) => renderRecordDetail(el, { recordId: id }) };
  if (section === "review" && id) return { name: "review", run: (el) => renderReview(el, { matchId: id }) };
  if (section === "journey" && id) return { name: "journey", run: (el) => renderWorkspace(el, { journeyId: id, focus: query.get("focus") || "" }) };
  if (section === "session" && id) return { name: "session", run: (el) => renderSession(el, { journeyId: id }) };
  if (section === "settings") return { name: "settings", run: (el) => renderSettings(el) };
  return { name: "tasks", main: true, run: (el) => renderTasks(el, { filter: query.get("filter") || "all" }) };
}

function render() {
  if (typeof cleanup === "function") { try { cleanup(); } catch (_) { /* ignore */ } }
  cleanup = null;
  clear(root);
  const current = view();
  const page = h("main", { class: "os-app", "data-view": current.name });
  append(root, page);
  if (current.main) append(page, renderShellHeader({ active: current.name }));
  const body = h("section", { class: "os-view" });
  append(page, body);
  cleanup = current.run(body) || null;
  if (current.main) append(page, renderBottomNav(current.name));
  window.scrollTo({ top: 0 });
}

/** Push-notification links (?openOperation=…) and legacy deep links → routes. */
function applyDeepLink() {
  const params = new URLSearchParams(location.search);
  const operationId = params.get("openOperation");
  const opportunityId = params.get("openOpportunity");
  const matchId = params.get("openMatch");
  const open = params.get("open");
  if (open) {
    const clean = new URL(location.href);
    clean.searchParams.delete("open");
    history.replaceState({}, "", `${clean.pathname}${clean.search}${clean.hash}`);
    if (open === "add-opportunity") go("record/new?kind=OFFER");
    else if (open === "operations") go("tasks");
  }
  if (!operationId && !opportunityId && !matchId) return;
  const clean = new URL(location.href);
  ["openOperation", "openOpportunity", "openMatch", "openDailyTask", "openAppointment", "focusFollowUp"].forEach((k) => clean.searchParams.delete(k));
  history.replaceState({}, "", `${clean.pathname}${clean.search}`);
  if (operationId) {
    const openTask = () => {
      const task = state.tasks.find((t) => t.id === operationId);
      if (!task) return false;
      const type = String(task.type || "").toUpperCase();
      if (type === "MATCH_REVIEW" && task.matchId) go(`review/${task.matchId}`);
      else if (type.startsWith("SESSION_") && task.journeyId) go(`session/${task.journeyId}`);
      else if (task.journeyId) go(`journey/${task.journeyId}`);
      else if (task.opportunityId) go(`record/${task.opportunityId}`);
      return true;
    };
    if (!openTask()) {
      const off = subscribe((kind) => { if (kind === "tasks" && openTask()) off(); });
      setTimeout(off, 8000);
    }
    return;
  }
  if (matchId) { go(`review/${matchId}`); return; }
  if (opportunityId) go(`record/${opportunityId}`);
}

async function startOfficeApp() {
  if (!firebaseReady()) {
    append(root, h("main", { class: "os-app" }, h("div", { class: "os-alert bad", text: "تعذر تحميل خدمات المنصة. تحقق من الاتصال ثم أعد تحميل الصفحة." })));
    return;
  }
  const user = await waitForAuth();
  if (!user) {
    renderLogin(root, { onSignedIn: enterOffice });
    return;
  }
  const officeId = preferredOfficeId();
  const access = officeId ? await loadOfficeAccess(officeId) : { ok: false, reason: "signed_out" };
  if (!access.ok) {
    await signOutOffice();
    renderLogin(root, { onSignedIn: enterOffice, message: ACCESS_MESSAGES[access.reason] });
    return;
  }
  enterOffice();
}

let entered = false;
function enterOffice() {
  if (entered) { render(); return; }
  entered = true;
  document.title = session.office?.officeName || "المكتب";
  startOfficeData(session.officeId);
  setRenderer(render);
  window.addEventListener("hashchange", () => { noteNavigation(); render(); });
  applyDeepLink();
  render();
  // Repair pass: re-creates any review/task whose write was interrupted (idempotent).
  api("/os/reconcile", { officeId: session.officeId }).catch(() => {});
}

async function boot() {
  const publicTarget = publicOfficeTarget();
  if (publicTarget) {
    await renderPublicOffice(root, publicTarget);
    return;
  }
  await startOfficeApp();
}

boot().catch((error) => {
  console.error("[office-os] boot", error);
  toast("تعذر تشغيل التطبيق — أعد تحميل الصفحة", "bad");
});

