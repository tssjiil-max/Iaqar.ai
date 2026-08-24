/**
 * Mounts compact daily-task execution cards into #contentV2.
 * Does not persist client-send, and does not copy opportunity data cards.
 */

import { buildDailyTaskListHtml } from "./card.js";
import {
  dailyTaskDetailsHash,
  dailyTasksDemoFixtures,
  mapOperationsItemsToDailyTasks
} from "./domain.js";

const state = {
  root: null,
  tasks: [],
  bound: false
};

function useDemoFixtures() {
  try {
    return new URLSearchParams(window.location.search).get("cv2Tasks") === "1";
  } catch {
    return false;
  }
}

function currentTasks() {
  if (useDemoFixtures()) return dailyTasksDemoFixtures();
  return state.tasks;
}

function openExistingOfferDetails(task) {
  const hash = dailyTaskDetailsHash(task);
  if (!hash) return;
  const href = `${window.location.pathname}${window.location.search}${hash}`;
  if (window.history?.replaceState) window.history.replaceState(window.history.state, "", href);
  else window.location.hash = hash;
  window.IAQAR?.homeTabs?.switchTo?.("opportunities");
  window.IAQAR?.contentV2?.render?.();
}

function onListClick(event) {
  const root = state.root;
  if (!root) return;
  const card = event.target.closest("[data-cv2-exec-task]");
  if (!card || !root.contains(card)) return;
  const task = {
    opportunityId: card.getAttribute("data-opportunity-id"),
    offerId: card.getAttribute("data-offer-id"),
    requestId: card.getAttribute("data-request-id"),
    matchId: card.getAttribute("data-match-id")
  };
  const secondary = event.target.closest("[data-cv2-exec-secondary]");
  if (secondary) {
    event.preventDefault();
    const action = secondary.getAttribute("data-cv2-exec-secondary");
    if (action === "open_offer") openExistingOfferDetails(task);
    return;
  }
  const primary = event.target.closest("[data-cv2-exec-primary]");
  if (primary) {
    event.preventDefault();
    // Reserved for a later CLIENT_MATCH_REVIEW session. No send in this round.
  }
}

function renderList() {
  if (!state.root) return;
  state.root.innerHTML = buildDailyTaskListHtml(currentTasks());
}

function onOperationsData(event) {
  if (useDemoFixtures()) return;
  const items = Array.isArray(event.detail?.items) ? event.detail.items : [];
  state.tasks = mapOperationsItemsToDailyTasks(items);
  renderList();
}

export function unmountDailyTasksContentV2() {
  window.removeEventListener("iaqar:operations-data", onOperationsData);
  if (state.root) {
    state.root.removeEventListener("click", onListClick);
    state.root.innerHTML = "";
  }
  state.root = null;
  state.bound = false;
}

export function mountDailyTasksContentV2(root) {
  if (!root) return;
  if (state.root && state.root !== root) unmountDailyTasksContentV2();
  const alreadyMounted = state.root === root && state.bound;
  state.root = root;
  window.removeEventListener("iaqar:operations-data", onOperationsData);
  window.addEventListener("iaqar:operations-data", onOperationsData);
  if (!alreadyMounted) {
    root.addEventListener("click", onListClick);
    state.bound = true;
  }
  if (!useDemoFixtures()) {
    const existing = window.IAQAR?.operationsItems;
    if (Array.isArray(existing)) state.tasks = mapOperationsItemsToDailyTasks(existing);
  }
  renderList();
}
