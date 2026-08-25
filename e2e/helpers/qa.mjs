export function attachWatchers(page) {
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const ignored = [
    /\/__\/firebase\/init\.js/,
    /fonts\.googleapis\.com/,
    /fonts\.gstatic\.com/,
    /favicon/,
    /gstatic\.com\/firebasejs/,
    /Failed to load resource/,
    /net::ERR_/,
    /Firebase: No Firebase App/,
    /app-compat\/no-app/,
    /installations\/installations/
  ];
  function allow(text) {
    return ignored.some((pattern) => pattern.test(String(text || "")));
  }
  page.on("pageerror", (error) => {
    const text = String(error.message || error);
    if (!allow(text)) pageErrors.push(text);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (allow(text)) return;
    consoleErrors.push(text);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (ignored.some((pattern) => pattern.test(url))) return;
    if (/iaqar-.*workers\.dev/.test(url) && !/party\/sessions|opportunity\/patch|cooperation|match\/living/.test(url)) {
      return;
    }
    failedRequests.push(`${request.method()} ${url} ${request.failure()?.errorText || ""}`);
  });
  return {
    pageErrors,
    consoleErrors,
    failedRequests,
    unexpectedJs() {
      return [...pageErrors, ...consoleErrors];
    }
  };
}

export async function resetQa(request, { matching = false, officeId = "qa-office-client" } = {}) {
  const response = await request.post("/qa/reset");
  if (!response.ok()) throw new Error("qa reset failed");
  if (!matching) return;
  const matched = await request.post("/qa/run-matching", { data: { officeId } });
  if (!matched.ok()) throw new Error("qa matching failed");
}

export async function runQaMatching(request, officeId = "qa-office-client") {
  const response = await request.post("/qa/run-matching", { data: { officeId } });
  if (!response.ok()) throw new Error("qa matching failed");
  return response.json();
}

export async function stubRemoteWorker(page, origin) {
  const base = String(origin || "http://127.0.0.1:4191").replace(/\/+$/, "");
  await page.route(/https:\/\/[^/]*workers\.dev\/.*/, async (route) => {
    const incoming = new URL(route.request().url());
    const dest = `${base}${incoming.pathname}${incoming.search}`;
    const response = await route.fetch(dest, {
      method: route.request().method(),
      headers: {
        ...route.request().headers(),
        host: new URL(base).host
      },
      data: route.request().postData()
    });
    await route.fulfill({ response });
  });
}

export async function openHarness(page, { officeId = "qa-office-client", tab = "tasks" } = {}) {
  const watchers = attachWatchers(page);
  await page.goto(`/qa/?officeId=${encodeURIComponent(officeId)}&tab=${tab}`);
  await page.getByTestId("qa-app").waitFor();
  return watchers;
}

export async function openParty(page, token, origin) {
  const watchers = attachWatchers(page);
  await stubRemoteWorker(page, origin);
  await page.goto(`/qa/party.html?cv2Party=${encodeURIComponent(token)}`);
  await page.locator("[data-party-shell][data-party], [data-party-error]").waitFor();
  const error = page.locator("[data-party-error]");
  if (await error.count()) {
    throw new Error(`party link invalid: ${(await error.innerText()).trim()}`);
  }
  return watchers;
}

export function extractPartyToken(whatsappUrl) {
  const raw = String(whatsappUrl || "");
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    decoded = raw;
  }
  const match = decoded.match(/cv2Party[=%](?:3D)?([a-f0-9]{32,128})/i);
  return match ? match[1] : "";
}
