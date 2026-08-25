#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { mapOperationsItemsToDailyTasks } from "../src/v2/content/daily-tasks/domain.js";
import { buildDailyTaskCardHtml } from "../src/v2/content/daily-tasks/card.js";
import { buildCooperationDailyTaskView, COOPERATION_STAGE } from "../public/js/cooperation-workflow-domain.js";
import { mapOpportunityDetailsV2ViewModel } from "../public/js/opportunity-details-v2-domain.js";
import { buildOpportunityDataCardV2, buildCompleteMissingButtonV2 } from "../public/js/v2/opportunity-details/data-card.js";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";

const root = path.resolve(import.meta.dirname, "..");
const outDir = "/opt/cursor/artifacts";
const tmpDir = "/tmp/daily-tasks-workflow-shots";
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const contentCss = readFileSync(path.join(root, "public", "css", "content-v2.css"), "utf8");
const taskCss = readFileSync(path.join(root, "src", "v2", "content", "daily-tasks", "styles.css"), "utf8");

function page(title, inner) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@500;700;800&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; background: #f4f8f6; font-family: Tajawal, Arial, sans-serif; }
    .shot-wrap { padding: 12px; max-width: 390px; margin: 0 auto; }
    .shot-note { margin: 0 0 8px; font: 800 13px Tajawal, sans-serif; color: #087064; }
    ${contentCss}
    ${taskCss}
  </style>
</head>
<body>
  <div class="shot-wrap">
    <p class="shot-note">${title}</p>
    ${inner}
  </div>
</body>
</html>`;
}

const matchItem = {
  operationType: "MATCH_REVIEW",
  matchId: "match_aziz_1842",
  clientRequestId: "req_1842",
  ownerOfferId: "offer_1842",
  opportunityId: "req_1842",
  propertyType: "شقة",
  purpose: "RENT",
  district: "العزيزية",
  city: "المدينة المنورة",
  budget: 55000,
  area: 120,
  candidatePropertyType: "شقة",
  candidatePurpose: "RENT",
  candidateDistrict: "العزيزية",
  candidateCity: "المدينة المنورة",
  candidateSalePrice: 50000,
  candidateArea: 125,
  matchReasons: ["نفس الحي", "ضمن الميزانية", "المساحة متقاربة"]
};

const [matchTask] = mapOperationsItemsToDailyTasks([matchItem], new Date());
const clientTask = mapOperationsItemsToDailyTasks([{
  ...matchItem,
  livingStage: "CLIENT_INTERESTED",
  ownerContactNeeded: true,
  livingTimeline: [
    { type: "send", actor: "BROKER", label: "تم فتح واتساب للعميل", createdAt: "2026-08-25T09:20:00.000Z" },
    { type: "opened", actor: "CLIENT", label: "فتح العميل الرابط", createdAt: "2026-08-25T09:24:00.000Z" },
    { type: "reply", actor: "CLIENT", label: "العميل مهتم بالعقار", createdAt: "2026-08-25T09:27:00.000Z" }
  ]
}], new Date())[0];
const ownerTask = mapOperationsItemsToDailyTasks([{
  ...matchItem,
  livingStage: "PROPERTY_AVAILABLE",
  livingTimeline: [
    ...(clientTask.timeline || []),
    { type: "owner_send", actor: "BROKER", label: "تم طلب تأكيد توفر العقار من المالك", createdAt: "2026-08-25T09:31:00.000Z" },
    { type: "reply", actor: "OWNER", label: "المالك أكد أن العقار متاح", createdAt: "2026-08-25T09:35:00.000Z" }
  ]
}], new Date())[0];

const coop = {
  id: "coop_431",
  cooperationTaskId: "coop_431",
  originatingOfficeId: "office-client",
  targetOfficeId: "office-wadi",
  originatingOfficeName: "مكتب النور العقاري",
  targetOfficeName: "مكتب الوادي العقاري",
  currentStage: COOPERATION_STAGE.MATCH_FOUND,
  originListing: {
    opportunityKind: "REQUEST",
    propertyType: "أرض",
    purpose: "SALE",
    district: "السكب",
    priceOrBudget: 850000,
    area: 1175
  },
  counterpartListing: {
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    district: "السكب",
    priceOrBudget: 830000,
    area: 1180
  },
  proximityLabel: "نفس الحي",
  compatibilityLabel: "مطابقة مرتفعة",
  matchReasons: ["السعر مناسب", "المواصفات متقاربة"]
};
const coopView = buildCooperationDailyTaskView(coop, { officeId: "office-client" });
const waitingView = buildCooperationDailyTaskView({
  ...coop,
  currentStage: COOPERATION_STAGE.WAITING_PARTNER,
  status: "PENDING",
  requestedAt: "2026-08-25T09:00:00.000Z"
}, { officeId: "office-client" });

const incomplete = mapOpportunityDetailsV2ViewModel("opp_1849", {
  opportunityKind: "OFFER",
  purpose: "SALE",
  propertyType: "أرض",
  city: "المدينة المنورة",
  district: "",
  advertiserRole: "OWNER",
  contactPhone: "0511123456"
});
const complete = mapOpportunityDetailsV2ViewModel("opp_1850", {
  opportunityKind: "OFFER",
  purpose: "SALE",
  propertyType: "أرض",
  city: "المدينة المنورة",
  district: "السكب",
  salePrice: 850000,
  area: 1175,
  advertiserRole: "OWNER",
  contactPhone: "0511123456"
});

const shots = [
  { file: "dt_01_match_collapsed.html", title: "مطابقة جديدة مختصرة", html: buildDailyTaskCardHtml(matchTask) },
  { file: "dt_02_match_expanded.html", title: "مطابقة موسعة داخل المهام اليومية", html: buildDailyTaskCardHtml(matchTask, { open: true }) },
  { file: "dt_03_match_full_details.html", title: "التفاصيل الكاملة داخل المهام اليومية", html: buildDailyTaskCardHtml(matchTask, { open: true, detailsOpen: true }) },
  { file: "dt_04_timeline_client.html", title: "الإجراءات بعد رد العميل", html: buildDailyTaskCardHtml(clientTask, { open: true }) },
  { file: "dt_05_timeline_owner.html", title: "الإجراءات بعد رد المالك", html: buildDailyTaskCardHtml(ownerTask, { open: true }) },
  { file: "dt_06_coop_collapsed.html", title: "مطابقة تعاون مختصرة", html: buildDailyTaskCardHtml(coopView) },
  { file: "dt_07_coop_expanded.html", title: "تعاون موسع مع العرض والطلب", html: buildDailyTaskCardHtml(coopView, { open: true }) },
  { file: "dt_08_coop_waiting.html", title: "بانتظار رد المكتب بالاسم", html: buildDailyTaskCardHtml(waitingView, { open: true }) },
  {
    file: "dt_09_opportunity_incomplete.html",
    title: "فرصة تحتاج استكمال",
    html: `<p class="cv2-inbox-section">يحتاج استكمال</p><div class="cv2-inbox-section-rule"></div>${buildOpportunityDataCardV2(incomplete)}${buildCompleteMissingButtonV2(incomplete)}`
  },
  {
    file: "dt_10_opportunity_matching.html",
    title: "بعد الحفظ انتقل لقيد المطابقة",
    html: `<p class="cv2-inbox-section">قيد المطابقة</p><div class="cv2-inbox-section-rule"></div>${buildOpportunityDataCardV2(complete, { statusLine: "قيد المطابقة" })}`
  }
];

for (const shot of shots) {
  writeFileSync(path.join(tmpDir, shot.file), page(shot.title, shot.html));
}

const pngNames = [
  "review_01_match_collapsed.png",
  "review_02_match_expanded.png",
  "review_03_match_full_details.png",
  "review_04_timeline_client.png",
  "review_05_timeline_owner.png",
  "review_06_coop_collapsed.png",
  "review_07_coop_expanded.png",
  "review_08_coop_waiting.png",
  "review_09_opportunity_incomplete.png",
  "review_10_opportunity_matching.png"
];

const shotHeights = [700, 1100, 1600, 1400, 1600, 700, 1400, 1500, 900, 800];

for (let i = 0; i < shots.length; i += 1) {
  const htmlPath = path.join(tmpDir, shots[i].file);
  const pngPath = path.join(outDir, pngNames[i]);
  const result = spawnSync("/usr/bin/google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--screenshot=${pngPath}`,
    `--window-size=390,${shotHeights[i]}`,
    `file://${htmlPath}`
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

const extra = [
  { file: "dt_17_360.html", png: "review_17_viewport_360.png", width: 360, height: 1600, title: "TEST 17 — 360px", html: buildDailyTaskCardHtml(matchTask, { open: true, detailsOpen: true }) },
  { file: "dt_17_390.html", png: "review_17_viewport_390.png", width: 390, height: 1600, title: "TEST 17 — 390px", html: buildDailyTaskCardHtml(matchTask, { open: true, detailsOpen: true }) },
  { file: "dt_17_430.html", png: "review_17_viewport_430.png", width: 430, height: 1600, title: "TEST 17 — 430px", html: buildDailyTaskCardHtml(matchTask, { open: true, detailsOpen: true }) }
];
for (const shot of extra) {
  writeFileSync(path.join(tmpDir, shot.file), page(shot.title, shot.html));
  const result = spawnSync("/usr/bin/google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--screenshot=${path.join(outDir, shot.png)}`,
    `--window-size=${shot.width},${shot.height}`,
    `file://${path.join(tmpDir, shot.file)}`
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  pngNames.push(shot.png);
}

void evaluateMatchingReadiness;
console.log(`wrote ${pngNames.length} screenshots to ${outDir}`);
