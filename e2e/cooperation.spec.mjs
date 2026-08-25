import { test, expect } from "@playwright/test";
import { openHarness, resetQa } from "./helpers/qa.mjs";

test.beforeEach(async ({ request }) => {
  await resetQa(request);
});

test("cooperation collapsed card names the partner office", async ({ page }) => {
  await openHarness(page);
  const card = page.locator('[data-cv2-exec-task][data-cooperation-id="coop_431"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("#C-0431");
  await expect(card).toContainText("مكتب الوادي العقاري");
  await expect(card).not.toContainText("المكتب الآخر");
});

test("opening cooperation shows both listings and requesting updates the same task", async ({ page }) => {
  await openHarness(page);
  const card = page.locator('[data-cv2-exec-task][data-cooperation-id="coop_431"]');
  await card.getByTestId("coop-open").click();
  await expect(card).toContainText("مكتبك");
  await expect(card).toContainText("850,000");
  await expect(card).toContainText("830,000");
  await card.getByTestId("request-cooperation").click();
  await page.reload();
  const waiting = page.locator('[data-cv2-exec-task][data-cooperation-id="coop_431"]');
  await waiting.getByTestId("coop-open").click();
  await expect(waiting).toContainText("بانتظار رد مكتب الوادي العقاري");
  await expect(page.locator('[data-cooperation-id="coop_431"]')).toHaveCount(1);
});

test("partner office can accept without seeing the client phone", async ({ page }) => {
  await openHarness(page);
  await page.locator('[data-cooperation-id="coop_431"]').getByTestId("coop-open").click();
  await page.getByTestId("request-cooperation").click();

  await page.goto("/qa/?officeId=qa-office-wadi&tab=tasks");
  const partner = page.locator('[data-cv2-exec-task][data-cooperation-id="coop_431"]');
  await expect(partner).toBeVisible();
  await expect(partner).not.toContainText("0508884310");
  await partner.getByTestId("coop-open").click();
  await partner.getByTestId("accept-cooperation").click();
  await page.reload();
  await page.locator('[data-cooperation-id="coop_431"]').getByTestId("coop-open").click();
  await expect(page.locator('[data-cooperation-id="coop_431"]')).not.toContainText("بانتظار رد");
});

test("partner office can reject without seeing the client phone", async ({ page }) => {
  await openHarness(page);
  await page.locator('[data-cooperation-id="coop_431"]').getByTestId("coop-open").click();
  await page.getByTestId("request-cooperation").click();
  await page.goto("/qa/?officeId=qa-office-wadi&tab=tasks");
  const partner = page.locator('[data-cv2-exec-task][data-cooperation-id="coop_431"]');
  await partner.getByTestId("coop-open").click();
  await expect(partner).not.toContainText("0508884310");
  await partner.getByTestId("reject-cooperation").click();
  await page.reload();
  await expect(page.locator('[data-cooperation-id="coop_431"]')).toHaveCount(0);
});

test("double-clicking request cooperation does not duplicate the record", async ({ page, request }) => {
  await openHarness(page);
  const card = page.locator('[data-cv2-exec-task][data-cooperation-id="coop_431"]');
  await card.getByTestId("coop-open").click();
  await card.getByTestId("request-cooperation").dblclick();
  const state = await request.get("/qa/state");
  const payload = await state.json();
  const ids = Object.keys(payload.state.cooperations);
  expect(ids.filter((id) => id.startsWith("coop_431"))).toEqual(["coop_431"]);
});
