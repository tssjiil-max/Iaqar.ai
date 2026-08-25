import { test, expect } from "@playwright/test";
import { extractPartyToken, openHarness, openParty, resetQa, runQaMatching } from "./helpers/qa.mjs";
import { mkdirSync } from "node:fs";

const ORIGIN = "http://127.0.0.1:4191";
const ARTIFACTS = "/opt/cursor/artifacts";
const MATCH_ID = "match_aziz_1842";
const REQUEST_ID = "qa_req_1842";
const OFFER_ID = "qa_offer_1842";
const TASK_ID = "mg_qa_req_1842";

function shot(page, name) {
  mkdirSync(ARTIFACTS, { recursive: true });
  return page.screenshot({ path: `${ARTIFACTS}/${name}`, fullPage: true });
}

function matchCard(page) {
  return page.locator(`[data-cv2-exec-task][data-match-id="${MATCH_ID}"]`);
}

async function openCleanParty(browser, token) {
  const context = await browser.newContext({
    locale: "ar-SA",
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();
  await openParty(page, token, ORIGIN);
  return { context, page };
}

test("golden journey steps 1-18: offers → match → client → owner → appointment", async ({ page, browser, request }) => {
  await resetQa(request);

  const watchers = await openHarness(page, { tab: "offers" });

  const requestRow = page.locator(`[data-testid="inbox-row"][data-opportunity-id="${REQUEST_ID}"]`);
  const offerRow = page.locator(`[data-testid="inbox-row"][data-opportunity-id="${OFFER_ID}"]`);
  await expect(requestRow).toBeVisible();
  await expect(offerRow).toBeVisible();
  await expect(requestRow).toContainText("شقة");
  await expect(requestRow).toContainText("العزيزية");
  await expect(requestRow).toContainText("المدينة المنورة");
  await expect(requestRow).toContainText("55,000");
  await expect(requestRow).toContainText("120");
  await expect(offerRow).toContainText("شقة");
  await expect(offerRow).toContainText("العزيزية");
  await expect(offerRow).toContainText("50,000");
  await expect(offerRow).toContainText("125");
  await expect(requestRow).toContainText("قيد المطابقة");
  await expect(offerRow).toContainText("قيد المطابقة");
  await expect(requestRow).not.toContainText("6 من 6");
  await expect(offerRow).not.toContainText("6 من 6");
  const incomplete = page.locator('[data-testid="inbox-row"][data-opportunity-id="qa_offer_incomplete"]');
  await expect(incomplete).toContainText("يحتاج استكمال");
  await expect(incomplete).not.toContainText("6 من 6");

  const matched = await runQaMatching(request);
  const pair = (matched.matches || []).find((row) => row.requestId === REQUEST_ID && row.offerId === OFFER_ID);
  expect(pair, "matching engine did not link the QA request and offer").toBeTruthy();
  expect(pair.matchId).toBe(MATCH_ID);
  expect(pair.created).toBe(true);

  await page.reload();
  await page.getByTestId("tab-tasks").click();
  const card = matchCard(page);
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("data-task-id", TASK_ID);
  await expect(card).toHaveAttribute("data-request-id", REQUEST_ID);
  await expect(card).toHaveAttribute("data-offer-id", OFFER_ID);
  await expect(card).toHaveAttribute("data-match-id", MATCH_ID);
  await expect(card).toContainText("مطابقة جديدة");
  await expect(card).toContainText("شقة للإيجار");
  await expect(card).toContainText("العزيزية");
  await expect(card).toContainText("المدينة المنورة");
  await expect(card).toContainText("50,000");
  await expect(card).toContainText("#A-1842");
  await expect(card.getByTestId("match-open")).toHaveText("عرض البيانات");
  await expect(card).not.toContainText(/^مطابقة جديدة\s*$/);
  await shot(page, "golden-01-match-task.png");

  await card.getByTestId("match-open").click();
  await expect(card).toContainText("طلب العميل");
  await expect(card).toContainText("شقة");
  await expect(card).toContainText("العزيزية");
  await expect(card).toContainText("55,000");
  await expect(card).toContainText("120");
  await expect(card).toContainText("العرض");
  await expect(card).toContainText("50,000");
  await expect(card).toContainText("125");
  await expect(card).toContainText("نفس الحي");
  await expect(card).toContainText("ضمن الميزانية");
  await expect(card).toContainText("المساحة متقاربة");
  await expect(card).toContainText("دورك الآن");
  await expect(card).toContainText("إرسال العرض للعميل");
  await expect(card).not.toContainText("—");
  await expect(card.getByTestId("send-client")).toBeVisible();

  await card.getByTestId("send-client").click();
  await expect(page.locator("#toast")).toContainText("تم فتح واتساب");
  await expect(page.locator("#toast")).not.toContainText("تم الإرسال");
  const clientOpened = await page.evaluate(() => window.__QA_OPENED__);
  expect(clientOpened).toMatch(/^https:\/\/wa\.me\/966501111842\?text=/);
  const clientToken = extractPartyToken(clientOpened);
  expect(clientToken).toMatch(/^[a-f0-9]{32,128}$/i);

  const client = await openCleanParty(browser, clientToken);
  await expect(client.page.locator("#accessGate, .access-gate")).toHaveCount(0);
  await expect(client.page.getByText("تسجيل دخول مكتب")).toHaveCount(0);
  await expect(client.page.getByText("أنا عميل")).toHaveCount(0);
  await expect(client.page.locator("[data-party-shell]")).toHaveAttribute("data-party", "client");
  await expect(client.page.getByText("عقار مناسب لطلبك")).toBeVisible();
  await expect(client.page.locator("body")).toContainText("شقة");
  await expect(client.page.locator("body")).toContainText("للإيجار");
  await expect(client.page.locator("body")).toContainText("العزيزية");
  await expect(client.page.locator("body")).toContainText("المدينة المنورة");
  await expect(client.page.locator("body")).toContainText("50,000");
  await expect(client.page.locator("body")).toContainText("125");
  await expect(client.page.locator("body")).not.toContainText("0502221842");
  await expect(client.page.locator("body")).not.toContainText("0501111842");
  await expect(client.page.locator("body")).not.toContainText(MATCH_ID);
  await expect(client.page.locator("body")).not.toContainText(clientToken);
  await shot(client.page, "golden-02-client-initial.png");

  await client.page.getByTestId("party-interested").click();
  await expect(client.page.getByTestId("party-want_viewing")).toBeVisible();
  await expect(client.page.getByTestId("party-info_sufficient")).toBeVisible();
  await expect(client.page.getByText("عقار مناسب لطلبك")).toBeVisible();
  await expect(client.page.locator("body")).toContainText("50,000");
  await expect(client.page.getByTestId("party-want_viewing")).toBeVisible();
  await shot(client.page, "golden-03-client-interested.png");

  await page.reload();
  const afterInterested = matchCard(page);
  await expect(afterInterested).toHaveCount(1);
  await expect(afterInterested).toHaveAttribute("data-task-id", TASK_ID);
  await afterInterested.getByTestId("match-open").click();
  await expect(afterInterested).toContainText("العميل مهتم بالعقار");
  await expect(afterInterested.getByTestId("send-owner")).toHaveCount(0);
  await expect(afterInterested).toContainText("لا يوجد إجراء مطلوب منك الآن");

  await client.page.getByTestId("party-want_viewing").click();
  await expect(client.page.getByTestId("party-wait-property")).toBeVisible();
  await expect(client.page.getByText("عقار مناسب لطلبك")).toBeVisible();
  await client.page.reload();
  await expect(client.page.getByTestId("party-wait-property")).toBeVisible();
  await shot(client.page, "golden-04-client-viewing.png");

  await page.reload();
  const afterViewing = matchCard(page);
  await expect(afterViewing).toHaveAttribute("data-task-id", TASK_ID);
  await afterViewing.getByTestId("match-open").click();
  await expect(afterViewing).toContainText("العميل طلب معاينة");
  await expect(afterViewing).toContainText("تأكيد توفر العقار");
  await expect(afterViewing.getByTestId("send-owner")).toBeVisible();

  await afterViewing.getByTestId("send-owner").click();
  await expect(page.locator("#toast")).toContainText("تم فتح واتساب للمالك");
  const ownerOpened = await page.evaluate(() => window.__QA_OPENED__);
  expect(ownerOpened).toMatch(/^https:\/\/wa\.me\/966502221842\?text=/);
  const ownerToken = extractPartyToken(ownerOpened);
  expect(ownerToken).toMatch(/^[a-f0-9]{32,128}$/i);
  expect(ownerToken).not.toBe(clientToken);

  const owner = await openCleanParty(browser, ownerToken);
  await expect(owner.page.locator("#accessGate, .access-gate")).toHaveCount(0);
  await expect(owner.page.locator("[data-party-shell]")).toHaveAttribute("data-party", "owner");
  await expect(owner.page.getByText("يوجد عميل مهتم بعقارك")).toBeVisible();
  await expect(owner.page.locator("body")).toContainText("شقة");
  await expect(owner.page.locator("body")).toContainText("العزيزية");
  await expect(owner.page.locator("body")).toContainText("50,000");
  await expect(owner.page.locator("body")).toContainText("125");
  await expect(owner.page.getByText("هل العقار ما زال متاحًا؟")).toBeVisible();
  await expect(owner.page.getByTestId("party-property_available")).toBeVisible();
  await expect(owner.page.locator("body")).not.toContainText("0501111842");
  await expect(owner.page.locator("body")).not.toContainText(REQUEST_ID);
  await shot(owner.page, "golden-05-owner-availability.png");

  await owner.page.getByTestId("party-property_available").click();
  await expect(owner.page.getByTestId("party-wait-client-slot")).toBeVisible();
  await expect(owner.page.getByText("يوجد عميل مهتم بعقارك")).toBeVisible();
  await owner.page.reload();
  await expect(owner.page.getByTestId("party-wait-client-slot")).toBeVisible();
  await shot(owner.page, "golden-06-owner-available.png");

  await page.reload();
  const afterOwner = matchCard(page);
  await expect(afterOwner).toHaveAttribute("data-task-id", TASK_ID);
  await afterOwner.getByTestId("match-open").click();
  await expect(afterOwner).toContainText("المالك أكد أن العقار متاح");
  await expect(afterOwner).toContainText("لا يوجد إجراء مطلوب منك الآن");

  await client.page.reload();
  await expect(client.page.getByTestId("party-pick-slot")).toBeVisible();
  const slots = client.page.getByTestId("party-slot");
  await expect(slots).toHaveCount(4);
  const firstSlot = await slots.nth(0).getAttribute("data-party-slot");
  const secondSlot = await slots.nth(1).getAttribute("data-party-slot");
  expect(firstSlot).toBeTruthy();
  await slots.nth(0).click();
  await expect(client.page.getByTestId("party-wait-owner")).toBeVisible();

  const collide = await request.post("/qa/appointments", {
    data: { matchId: "match_close_9901", slot: firstSlot }
  });
  expect(collide.ok()).toBeTruthy();

  await owner.page.reload();
  await expect(owner.page.getByTestId("party-proposed-slot")).toBeVisible();
  await owner.page.getByTestId("party-confirm-appointment").click();
  await expect(owner.page.getByTestId("party-taken-message")).toContainText("هذا الموعد لم يعد متاحًا، اختر موعدًا آخر.");
  await owner.page.getByTestId("party-choose-another-slot").click();

  await client.page.reload();
  await expect(client.page.getByTestId("party-pick-slot")).toBeVisible();
  await client.page.locator(`[data-party-slot="${secondSlot}"]`).click();
  await expect(client.page.getByTestId("party-wait-owner")).toBeVisible();

  await owner.page.reload();
  await owner.page.getByTestId("party-confirm-appointment").click();
  await expect(owner.page.getByTestId("party-appointment-confirmed")).toContainText("تم تأكيد المعاينة");
  await expect(owner.page.getByTestId("party-appointment-confirmed")).toContainText("اليوم");
  await expect(owner.page.getByTestId("party-appointment-confirmed")).toContainText("الوقت");
  await owner.page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await owner.page.reload();
  await expect(owner.page.getByTestId("party-appointment-confirmed")).toContainText("تم تأكيد المعاينة");

  await client.page.reload();
  await expect(client.page.getByTestId("party-appointment-confirmed")).toContainText("تم تأكيد المعاينة");
  await expect(client.page.getByTestId("party-appointment-confirmed")).toContainText("اليوم");
  await expect(client.page.getByTestId("party-appointment-confirmed")).toContainText("الوقت");
  await client.page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await client.page.reload();
  await expect(client.page.getByTestId("party-appointment-confirmed")).toContainText("تم تأكيد المعاينة");
  await shot(client.page, "golden-07-appointment-confirmed.png");

  await page.reload();
  const finalCard = matchCard(page);
  await expect(finalCard).toHaveCount(1);
  await expect(finalCard).toHaveAttribute("data-task-id", TASK_ID);
  await expect(finalCard).toHaveAttribute("data-match-id", MATCH_ID);
  await expect(finalCard).toHaveAttribute("data-request-id", REQUEST_ID);
  await expect(finalCard).toHaveAttribute("data-offer-id", OFFER_ID);
  await expect(finalCard).toContainText("الموعد مؤكد");
  await expect(finalCard).toContainText("شقة للإيجار");
  await expect(finalCard).toContainText("العزيزية");
  await finalCard.getByTestId("match-open").click();
  await expect(finalCard).toContainText("تم العثور على مطابقة");
  await expect(finalCard).toContainText("تم فتح واتساب للعميل");
  await expect(finalCard).toContainText("العميل مهتم");
  await expect(finalCard).toContainText("العميل طلب معاينة");
  await expect(finalCard).toContainText("تم فتح واتساب للمالك");
  await expect(finalCard).toContainText("المالك أكد أن العقار متاح");
  await expect(finalCard).toContainText("تم اختيار الموعد");
  await expect(finalCard).toContainText("تم تأكيد المعاينة");
  await expect(finalCard).toContainText("لا يوجد إجراء مطلوب منك الآن");
  await expect(finalCard.getByTestId("complete-deal")).toHaveCount(0);
  await expect(page.locator(`[data-task-id="${TASK_ID}"]`)).toHaveCount(1);
  await shot(page, "golden-08-broker-final.png");

  const state = await request.get("/qa/state");
  const payload = await state.json();
  const living = payload.state.matches[MATCH_ID];
  expect(living.clientRequestId).toBe(REQUEST_ID);
  expect(living.ownerOfferId).toBe(OFFER_ID);
  expect(living.livingStage).toBe("APPOINTMENT_CONFIRMED");
  const clientSession = Object.values(payload.state.partySessions).find((row) => row.token === clientToken);
  const ownerSession = Object.values(payload.state.partySessions).find((row) => row.token === ownerToken);
  expect(clientSession.party).toBe("client");
  expect(ownerSession.party).toBe("owner");
  expect(clientSession.matchId).toBe(MATCH_ID);
  expect(ownerSession.matchId).toBe(MATCH_ID);

  expect(watchers.pageErrors, watchers.pageErrors.join("\n")).toEqual([]);
  await client.context.close();
  await owner.context.close();
});
