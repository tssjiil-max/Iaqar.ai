// Loads the real public/index.html shell into jsdom and boots the office-settings module
// against it, so DOM-level acceptance scenarios are asserted on the shipped document
// rather than on a regex over its source.

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

export const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

export function readRepositoryFile(...segments) {
  return readFileSync(path.join(repositoryRoot, ...segments), "utf8");
}

export function shellHtml() {
  return readRepositoryFile("public", "index.html");
}

/** Every `<style>` block in the shell, concatenated. */
export function shellStyles(document) {
  return Array.from(document.querySelectorAll("style")).map(node => node.textContent).join("\n");
}

let moduleCounter = 0;
const savedGlobals = new Map();

function defineGlobal(name, value) {
  if (!savedGlobals.has(name)) {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true
  });
}

function restoreGlobals() {
  for (const [name, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  savedGlobals.clear();
}

/**
 * @param {object} [options]
 * @param {boolean} [options.bootSettingsModule] import js/office-settings.js against the DOM
 * @param {object} [options.firebase] a stub placed on window.firebase before boot
 * @param {object} [options.officeRuntime] a stub placed on window.IAQAR.office before boot
 * @param {Function} [options.fetch] a stub fetch implementation
 */
export async function loadShell(options = {}) {
  const {
    bootSettingsModule = true,
    firebase = null,
    officeRuntime = null,
    fetch: fetchStub = null
  } = options;

  // External <script src> tags point at the Firebase CDN and the hosting-injected config;
  // jsdom does not fetch them, and their failure notices are noise for these assertions.
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(shellHtml(), {
    url: "https://iaqar.ai/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole
  });

  const { window } = dom;
  if (firebase) window.firebase = firebase;
  window.IAQAR = window.IAQAR || {};
  if (officeRuntime) window.IAQAR.office = officeRuntime;
  if (fetchStub) window.fetch = fetchStub;

  for (const name of [
    "window", "document", "localStorage", "sessionStorage", "CustomEvent", "Event",
    "Image", "HTMLElement", "Node", "getComputedStyle", "File", "Blob"
  ]) {
    if (name in window) defineGlobal(name, window[name]);
  }
  defineGlobal("navigator", window.navigator);
  if (fetchStub) defineGlobal("fetch", fetchStub);

  let settingsModule = null;
  let bankModule = null;
  if (bootSettingsModule) {
    moduleCounter += 1;
    const settingsSpecifier = new URL(
      pathToFileURL(path.join(repositoryRoot, "public", "js", "office-settings.js"))
    );
    // A fresh query string forces a fresh module instance per test, so each test binds to
    // its own DOM instead of the first one loaded in the process.
    settingsSpecifier.searchParams.set("shellInstance", String(moduleCounter));
    settingsModule = await import(settingsSpecifier.href);

    // Phase 3 bank controller is a separate module loaded next to settings in index.html.
    const bankSpecifier = new URL(
      pathToFileURL(path.join(repositoryRoot, "public", "js", "opportunity-bank.js"))
    );
    bankSpecifier.searchParams.set("shellInstance", String(moduleCounter));
    bankModule = await import(bankSpecifier.href);
  }

  return {
    dom,
    window,
    document: window.document,
    settingsModule,
    bankModule,
    styles: shellStyles(window.document),
    close() {
      restoreGlobals();
      dom.window.close();
    }
  };
}

/** Minimal Firebase compat stub: enough for the settings module to boot signed-out. */
export function firebaseStub({ user = null } = {}) {
  const listeners = [];
  return {
    auth: () => ({
      currentUser: user,
      onAuthStateChanged(listener) {
        listeners.push(listener);
        listener(user);
        return () => {};
      },
      signOut: async () => {}
    }),
    firestore: Object.assign(() => ({}), {
      FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" },
      Timestamp: { fromDate: date => ({ toDate: () => date }) }
    }),
    __listeners: listeners
  };
}
