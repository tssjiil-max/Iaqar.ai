import { test, expect } from "@playwright/test";
import { extractPartyToken, openHarness, openParty, resetQa } from "./helpers/qa.mjs";

const ORIGIN = "http://127.0.0.1:4191";

test.beforeEach(async ({ request }) => {
  await resetQa(request);
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
  expect(opened).toMatch(/cv2Party=[a-f0-9]{32,}/i);
});

test("client party page shows the listing and never the owner phone", async ({ page, context }) => {
  const broker = await openHarness(page);
  void broker;
  const card = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await card.getByTestId("match-open").click();
  await card.getByTestId("send-client").click();
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
  await expect(updated.getByTestId("send-owner")).toBeVisible();
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

test("owner party never exposes the client phone and can confirm availability", async ({ page, context }) => {
  await openHarness(page);
  const card = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await card.getByTestId("match-open").click();
  await card.getByTestId("send-client").click();
  const clientToken = extractPartyToken(await page.evaluate(() => window.__QA_OPENED__));
  const clientPage = await context.newPage();
  await openParty(clientPage, clientToken, ORIGIN);
  await clientPage.getByTestId("party-interested").click();

  await page.reload();
  const after = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await after.getByTestId("match-open").click();
  await after.getByTestId("send-owner").click();
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
