/**
 * Writes a live check's failure as a GitHub Actions annotation, so the reason is readable from the run summary
 * without downloading the raw log. The text is cleaned first: no long token-like strings, no phone numbers, no e-mails.
 */
export function cleanFailureText(value, max = 1500) {
  return String(value ?? "")
    .replace(/(Bearer\s+)\S+/gi, "$1***")
    .replace(/\b[A-Za-z0-9_\-]{40,}\b/g, "***")
    .replace(/(\+?966|0)5\d{8}\b/g, "05********")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "***@***")
    .replace(/\r/g, "")
    .slice(0, max);
}

export function annotateFailure(title, error, extra = "") {
  const lines = String(error?.stack || error?.message || error || "").split("\n").filter((l) => l.trim() && !/^\s+at\s/.test(l)).slice(0, 12);
  const text = cleanFailureText([...lines, extra].filter(Boolean).join("\n"));
  const esc = (t) => t.replace(/%/g, "%25").replace(/\n/g, "%0A");
  console.log(`::error title=${title.replace(/[:,\n]/g, " ")}::${esc(text)}`);
  return text;
}

/** What the open pages are showing (alerts, toasts, the visible heading) — often the real reason a wait timed out. */
export async function visibleState(browser) {
  const out = [];
  for (const context of browser?.contexts?.() || []) {
    for (const page of context.pages()) {
      const state = await page.evaluate(() => {
        const pick = (sel) => [...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null).map((el) => el.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4);
        return { url: location.pathname + location.hash, heading: pick("h1, h2").slice(0, 2), alerts: pick(".os-alert, .os-toast, [role='alert'], [role='status']") };
      }).catch(() => null);
      if (state) out.push(`page ${state.url} · ${state.heading.join(" / ")} · ${state.alerts.join(" | ") || "no alert"}`);
    }
  }
  return out.join("\n");
}
