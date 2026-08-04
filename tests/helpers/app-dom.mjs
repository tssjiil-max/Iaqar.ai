import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { JSDOM } from "jsdom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const repoRoot = root;
export const indexHtml = readFileSync(join(root, "public", "index.html"), "utf8");

const APP_SCRIPTS = [
  "public/js/qrcode.js",
  "public/js/office-identity.js",
  "public/js/office-settings.js",
  "public/js/whatsapp-office.js"
];

/**
 * يبني نسخة من الصفحة المعتمدة داخل jsdom ثم يحقن سكربتات الواجهة بالترتيب.
 * سكربتات Firebase الخارجية لا تُحمَّل، وهو ما يختبر أيضًا سلوك العمل بلا تسجيل دخول.
 */
export async function createAppDom({ storedProfile = null, officeId = "platform" } = {}) {
  const dom = new JSDOM(indexHtml, {
    url: "https://iaqar.ai/",
    runScripts: "dangerously",
    pretendToBeVisual: true
  });
  const { window } = dom;

  await new Promise(resolve => {
    if (window.document.readyState === "complete") resolve();
    else window.addEventListener("load", resolve, { once: true });
  });

  if (storedProfile) {
    window.localStorage.setItem(`iaqar.officeProfile.${officeId}`, JSON.stringify(storedProfile));
  }

  for (const relative of APP_SCRIPTS) {
    const script = window.document.createElement("script");
    script.textContent = readFileSync(join(root, relative), "utf8");
    window.document.body.appendChild(script);
  }

  return { dom, window, document: window.document };
}

export function textOf(node) {
  return node ? node.textContent.replace(/\s+/g, " ").trim() : "";
}

export function submitForm(window, form) {
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

export function click(window, node) {
  node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}
