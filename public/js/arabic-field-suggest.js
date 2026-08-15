/**
 * Arabic text input with non-blocking suggestions (not a native select).
 */

function htmlEsc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function normalizeQuery(value) {
  return String(value || "").trim().toLowerCase();
}

export function wireArabicSuggestInput(input, options = [], config = {}) {
  if (!input || input.dataset.arabicSuggestWired === "1") return;
  input.dataset.arabicSuggestWired = "1";
  input.classList.add("arabic-suggest-input");

  const wrap = input.closest("label") || input.parentElement;
  if (wrap) wrap.classList.add("arabic-suggest-wrap");

  const ownerDocument = input.ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!ownerDocument) return;

  let list = wrap?.querySelector(`[data-suggest-for="${input.name || input.id}"]`);
  if (!list) {
    list = ownerDocument.createElement("ul");
    list.className = "arabic-suggest-list";
    list.dataset.suggestFor = input.name || input.id || "";
    list.hidden = true;
    input.insertAdjacentElement("afterend", list);
  }

  const max = Number(config.maxSuggestions || 12);
  const source = Array.isArray(options) ? options.map((v) => String(v || "").trim()).filter(Boolean) : [];

  const render = (query = "") => {
    const q = normalizeQuery(query);
    const filtered = source
      .filter((entry) => !q || normalizeQuery(entry).includes(q))
      .slice(0, max);
    list.innerHTML = filtered.map((entry) =>
      `<li><button type="button" data-pick="${htmlEsc(entry)}">${htmlEsc(entry)}</button></li>`
    ).join("");
    list.hidden = filtered.length === 0;
  };

  input.addEventListener("focus", () => render(input.value));
  input.addEventListener("input", () => {
    if (typeof config.onInput === "function") config.onInput(input.value);
    render(input.value);
  });

  list.addEventListener("mousedown", (event) => {
    const btn = event.target.closest("[data-pick]");
    if (!btn) return;
    event.preventDefault();
    const picked = btn.getAttribute("data-pick") || "";
    if (typeof config.onPick === "function") {
      config.onPick(picked, input);
    } else {
      input.value = picked;
    }
    list.hidden = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  ownerDocument.addEventListener("click", (event) => {
    if (!wrap?.contains(event.target)) list.hidden = true;
  });
}