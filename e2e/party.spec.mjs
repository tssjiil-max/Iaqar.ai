import { test, expect } from "@playwright/test";
import { extractPartyToken, openHarness, openParty, resetQa } from "./helpers/qa.mjs";

const ORIGIN = "http://127.0.0.1:4191";

test.beforeEach(async ({ request }) => {
  await resetQa(request, { matching: true });
});

test("send to client opens a WhatsApp deep-link and says تم فتح واتساب", async ({ page }) => {
  await openHarness(page);
  const card = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await card.getByTestId("match-open").click();
  await card.getByTestId("send-client").click();
  await expect(page.locator("#toast")).toContainText("تم فتح واتساب");
  await expect(page.locator("#toast")).not.toContainText("تم إرسال الرسالة");
  const opened = await page.evaluate(() => window.__QA_OPENED__);
  expect(opened).toMatch(/^https:\/\/wa\.me\/966501111842\?text=/);
  const token = extractPartyToken(opened);
  expect(token, "secure party token missing from WhatsApp URL").toMatch(/^[a-f0-9]{32,128}$/i);
  expect(opened.toLowerCase()).toContain("cv2party");
});

test("client party page shows the listing and never the owner phone", async ({ page, context }) => {
  const broker = await openHarness(page);
  void broker;
  const card = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await card.getByTestId("match-open").click();
  await card.getByTestId("send-client").click();
  await expect(page.locator("#toast")).toContainText("تم فتح واتساب");
  const opened = await page.evaluate(() => window.__QA_OPENED__);
  const token = extractPartyToken(opened);
  expect(token).toBeTruthy();

  const partyPage = await context.newPage();
  await openParty(partyPage, token, ORIGIN);
  await expect(partyPage.locator("[data-party-shell]")).toHaveAttribute("data-party", "client");
  await expect(partyPage.getByText("العزيزية")).toBeVisible();
  await expect(partyPage.getByText("50,000")).toBeVisible();
  await expect(partyPage.getByText("125")).toBeVisible();
  await expect(partyPage.locator("body")).not.toContainText("0502221842");
  await expect(partyPage.locator("body")).not.toContainText("966502221842");
  const html = await partyPage.content();
  expect(html).not.toMatch(/0502221842|966502221842/);
  await expect(partyPage.getByTestId("party-interested")).toBeVisible();
  await expect(partyPage.getByTestId("party-needs_details")).toBeVisible();
  await expect(partyPage.getByTestId("party-not_suitable")).toBeVisible();
});

test("client interested updates the same broker task timeline after reload", async ({ page, context }) => {
  await openHarness(page);
  const card = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await card.getByTestId("match-open").click();
  await card.getByTestId("send-client").click();
  await expect(page.locator("#toast")).toContainText("تم فتح واتساب");
  const token = extractPartyToken(await page.evaluate(() => window.__QA_OPENED__));
  const partyPage = await context.newPage();
  await openParty(partyPage, token, ORIGIN);
  await partyPage.getByTestId("party-interested").click();
  await expect(partyPage.getByText("تم تسجيل ردك")).toBeVisible();
  await partyPage.reload();
  await expect(partyPage.getByText("مهتم")).toBeVisible();

  await page.reload();
  const updated = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await updated.getByTestId("match-open").click();
  await expect(updated).toContainText("العميل مهتم");
  await expect(updated.getByTestId("send-owner")).toHaveCount(0);
  await expect(updated).toContainText("لا يوجد إجراء مطلوب منك الآن");
  await partyPage.getByTestId("party-want_viewing").click();
  await page.reload();
  const afterViewing = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await afterViewing.getByTestId("match-open").click();
  await expect(afterViewing).toContainText("العميل طلب معاينة");
  await expect(afterViewing.getByTestId("send-owner")).toBeVisible();
});

test("client needs more details shows follow-up choices", async ({ page, request, context }) => {
  const minted = await request.post("/party/sessions", {
    data: { officeId: "qa-office-client", matchId: "match_aziz_1842", party: "client" }
  });
  const { token } = await minted.json();
  const partyPage = await context.newPage();
  await openParty(partyPage, token, ORIGIN);
  await partyPage.getByTestId("party-needs_details").click();
  await expect(partyPage.getByTestId("party-detail_price")).toBeVisible();
  await expect(partyPage.getByTestId("party-detail_location")).toBeVisible();
  await expect(partyPage.getByTestId("party-detail_photos")).toBeVisible();
  await expect(partyPage.getByTestId("party-detail_specs")).toBeVisible();
  await partyPage.getByTestId("party-detail_price").click();
  await expect(partyPage.locator(".party-revealed")).toBeVisible();
});

test("client not_suitable persists on reload", async ({ page, request, context }) => {
  const minted = await request.post("/party/sessions", {
    data: { officeId: "qa-office-client", matchId: "match_aziz_1842", party: "client" }
  });
  const { token } = await minted.json();
  const partyPage = await context.newPage();
  await openParty(partyPage, token, ORIGIN);
  await partyPage.getByTestId("party-not_suitable").click();
  await expect(partyPage.getByText("تم تسجيل ردك")).toBeVisible();
  await partyPage.reload();
  await expect(partyPage.getByText("غير مناسب")).toBeVisible();
});

test("owner unavailable updates the broker task", async ({ page, request, context }) => {
  await request.post("/party/sessions", {
    data: { officeId: "qa-office-client", matchId: "match_aziz_1842", party: "client" }
  });
  const minted = await request.post("/party/sessions", {
    data: { officeId: "qa-office-client", matchId: "match_aziz_1842", party: "owner" }
  });
  const { token } = await minted.json();
  const ownerPage = await context.newPage();
  await openParty(ownerPage, token, ORIGIN);
  await ownerPage.getByTestId("party-not_available").click();
  await expect(ownerPage.getByText("تم تسجيل ردك")).toBeVisible();
  await page.goto("/qa/?officeId=qa-office-client&tab=tasks");
  await expect(page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]')).toHaveCount(0);
  const state = await request.get("/qa/state");
  const payload = await state.json();
  expect(payload.state.matches.match_aziz_1842.livingStage).toBe("MATCH_EXHAUSTED");
});

test("owner party never exposes the client phone and can confirm availability", async ({ page, context }) => {
  await openHarness(page);
  const card = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await card.getByTestId("match-open").click();
  await card.getByTestId("send-client").click();
  await expect(page.locator("#toast")).toContainText("تم فتح واتساب");
  const clientToken = extractPartyToken(await page.evaluate(() => window.__QA_OPENED__));
  const clientPage = await context.newPage();
  await openParty(clientPage, clientToken, ORIGIN);
  await clientPage.getByTestId("party-interested").click();
  await clientPage.getByTestId("party-want_viewing").click();

  await page.reload();
  const after = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await after.getByTestId("match-open").click();
  await after.getByTestId("send-owner").click();
  await expect(page.locator("#toast")).toContainText("تم فتح واتساب");
  const ownerToken = extractPartyToken(await page.evaluate(() => window.__QA_OPENED__));
  const ownerPage = await context.newPage();
  await openParty(ownerPage, ownerToken, ORIGIN);
  await expect(ownerPage.locator("[data-party-shell]")).toHaveAttribute("data-party", "owner");
  await expect(ownerPage.locator("body")).not.toContainText("0501111842");
  await ownerPage.getByTestId("party-property_available").click();
  await page.reload();
  const confirmed = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await confirmed.getByTestId("match-open").click();
  await expect(confirmed).toContainText("المالك أكد أن العقار متاح");
});
