import { test, expect } from "@playwright/test";
import { openHarness, resetQa } from "./helpers/qa.mjs";

test.beforeEach(async ({ request }) => {
  await resetQa(request);
});

test("collapsed match shows identity, type, district, city, price, and reference", async ({ page }) => {
  const watchers = await openHarness(page);
  const card = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("#A-1842");
  await expect(card).toContainText("شقة");
  await expect(card).toContainText("العزيزية");
  await expect(card).toContainText("المدينة المنورة");
  await expect(card).toContainText("50,000");
  await expect(card.getByTestId("send-client")).toHaveCount(0);
  expect(watchers.pageErrors, watchers.pageErrors.join("\n")).toEqual([]);
});

test("expanding a match stays inside Daily Tasks and a second open closes the first", async ({ page }) => {
  await openHarness(page);
  const first = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await first.getByTestId("match-open").click();
  await expect(first).toHaveClass(/is-open/);
  await expect(first).toContainText("طلب العميل");
  await expect(first).toContainText("العرض المطابق");
  await expect(first).toContainText("دورك الآن");
  await expect(page.getByTestId("panel-offers")).toBeHidden();

  const second = page.locator('[data-cv2-exec-task][data-match-id="match_close_9901"]');
  await second.getByTestId("match-open").click();
  await expect(second).toHaveClass(/is-open/);
  await expect(first).not.toHaveClass(/is-open/);
});

test("full details open and close without leaving the task", async ({ page }) => {
  await openHarness(page);
  const card = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
  await card.getByTestId("match-open").click();
  await card.getByTestId("match-details").click();
  await expect(card.locator("[data-cv2-exec-full-details]")).toBeVisible();
  await card.getByTestId("close-details").click();
  await expect(card).toHaveClass(/is-open/);
  await expect(card.locator("[data-cv2-exec-full-details]")).toHaveCount(0);
});

test("one request with several offers is a single grouped task", async ({ page }) => {
  await openHarness(page);
  const group = page.locator('[data-cv2-exec-task][data-request-id="qa_req_multi"]');
  await expect(group).toHaveCount(1);
  await group.getByTestId("match-open").click();
  await expect(group).toContainText("مرشح");
});

test("a request with no match does not create a fake daily task", async ({ page }) => {
  await openHarness(page);
  await expect(page.locator('[data-request-id="qa_req_nomatch"]')).toHaveCount(0);
});
