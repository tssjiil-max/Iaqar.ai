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
    /net::ERR_/
  ];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error.message || error));
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (ignored.some((pattern) => pattern.test(text))) return;
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

export async function resetQa(request) {
  const response = await request.post("/qa/reset");
  if (!response.ok()) throw new Error("qa reset failed");
}

export async function stubRemoteWorker(page, origin) {
  await page.route(/https:\/\/iaqar-[^/]+workers\.dev\/.*/, async (route) => {
    const incoming = new URL(route.request().url());
    const dest = `${origin}${incoming.pathname}${incoming.search}`;
    const headers = { ...route.request().headers() };
    delete headers.host;
    const response = await route.fetch(dest, {
      method: route.request().method(),
      headers,
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
  await page.goto(`/?cv2Party=${token}`);
  await page.locator("[data-party-shell]").waitFor();
  return watchers;
}

export function extractPartyToken(whatsappUrl) {
  const url = new URL(String(whatsappUrl || "").replace(/^https:\/\/wa\.me\/\d+\?text=/, "https://decoded/?text="));
  const text = decodeURIComponent(url.searchParams.get("text") || String(whatsappUrl || ""));
  const match = text.match(/cv2Party=([a-f0-9]{32,128})/i);
  return match ? match[1] : "";
}
