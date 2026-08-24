/**
 * Collapses the existing shell office card on opportunity details.
 * Expand state stays in memory for the current details visit only.
 */

const expandedCards = new WeakSet();

function officeLicenseCard(rootDocument = document) {
  return rootDocument.querySelector(".app > section.card.license")
    || rootDocument.querySelector("section.card.license");
}

function applyOfficeCardCollapse(card) {
  if (!card) return;
  const collapsed = !expandedCards.has(card);
  card.classList.toggle("is-office-collapsed", collapsed);
  const toggle = card.querySelector(".cv2-office-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

export function setupOfficeCardCollapse(rootDocument = document) {
  const card = officeLicenseCard(rootDocument);
  if (!card) return;
  let toggle = card.querySelector(".cv2-office-toggle");
  if (!toggle) {
    toggle = rootDocument.createElement("button");
    toggle.type = "button";
    toggle.className = "cv2-office-toggle";
    toggle.innerHTML = `<span>بيانات المكتب</span>
      <svg class="cv2-office-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`;
    toggle.addEventListener("click", () => {
      if (expandedCards.has(card)) expandedCards.delete(card);
      else expandedCards.add(card);
      applyOfficeCardCollapse(card);
    });
    card.insertBefore(toggle, card.firstChild);
  }
  card.classList.add("is-office-collapsible");
  applyOfficeCardCollapse(card);
}

export function teardownOfficeCardCollapse(rootDocument = document) {
  const card = officeLicenseCard(rootDocument);
  if (!card) return;
  expandedCards.delete(card);
  card.classList.remove("is-office-collapsible", "is-office-collapsed");
  card.querySelector(".cv2-office-toggle")?.remove();
}
