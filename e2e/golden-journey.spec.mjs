import { test, expect } from "@playwright/test";
import { extractPartyToken, openHarness, openParty, resetQa } from "./helpers/qa.mjs";

const ORIGIN = "http://127.0.0.1:4191";

test("golden journey: match → WhatsApp client → interested → owner available → broker progress", async ({ page, context }) => {
  await resetQa(page.request);
  const watchers = await openHarness(page);

  const match = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await expect(match).toContainText("#A-1842");
  await match.getByTestId("match-open").click();
  await expect(match).toContainText("طلب العميل");
  await expect(match).toContainText("العرض المطابق");
  await match.getByTestId("send-client").click();
  await expect(page.locator("#toast")).toContainText("تم فتح واتساب");

  const token = extractPartyToken(await page.evaluate(() => window.__QA_OPENED__));
  expect(token, "secure party token missing from WhatsApp URL").toBeTruthy();

  const clientPage = await context.newPage();
  await openParty(clientPage, token, ORIGIN);
  await expect(clientPage.locator("#accessGate, .access-gate")).toHaveCount(0);
  await clientPage.getByTestId("party-interested").click();
  await expect(clientPage.getByText("تم تسجيل ردك")).toBeVisible();

  await page.reload();
  const afterClient = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await afterClient.getByTestId("match-open").click();
  await expect(afterClient).toContainText("العميل مهتم");
  await afterClient.getByTestId("send-owner").click();

  const ownerToken = extractPartyToken(await page.evaluate(() => window.__QA_OPENED__));
  const ownerPage = await context.newPage();
  await openParty(ownerPage, ownerToken, ORIGIN);
  await ownerPage.getByTestId("party-property_available").click();

  await page.reload();
  const afterOwner = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await afterOwner.getByTestId("match-open").click();
  await expect(afterOwner).toContainText("المالك أكد أن العقار متاح");
  await expect(afterOwner).toContainText("تنسيق موعد المعاينة");
  expect(watchers.pageErrors, watchers.pageErrors.join("\n")).toEqual([]);
});
