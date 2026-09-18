import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { loadShell, repositoryRoot } from "./helpers/shell.mjs";

let instance = 0;

async function loadReview() {
  const context = await loadShell({ bootSettingsModule: false });
  const specifier = new URL(pathToFileURL(path.join(repositoryRoot, "public", "js", "opportunity-review.js")));
  specifier.searchParams.set("advertiserRoleTest", String(++instance));
  const module = await import(specifier.href);
  return { context, module };
}

function baseDefaults(kind) {
  return {
    importSimplifiedReview: true,
    importPlainLocationFields: true,
    opportunityKind: kind,
    purpose: kind === "REQUEST" ? "PURCHASE" : "SALE",
    operationTypeId: kind === "REQUEST" ? "purchase" : "sale",
    rawPropertyTypeText: "شقة",
    rawNeighborhoodText: "العزيزية",
    rawCityText: "المدينة المنورة",
    salePrice: kind === "OFFER" ? 650000 : "",
    budget: kind === "REQUEST" ? 650000 : "",
    area: 180,
    rooms: 4,
    advertiserRole: "UNKNOWN",
    advertiserPhoneNormalized: "+966501234567"
  };
}

function openSimplifiedReview(module, { kind, sourceText, directOwner = undefined }) {
  module.openOpportunityReview({
    fields: { opportunityKind: kind, directOwner, advertiserRole: "UNKNOWN" },
    sourceText,
    prepared: { opportunity: { opportunityKind: kind, directOwner, advertiserRole: "UNKNOWN" } },
    reviewDefaults: baseDefaults(kind)
  }, async () => {}, {
    importSimplifiedReview: true,
    title: "مراجعة الفرصة"
  });
}

test("unified REQUEST review exposes advertiser role and defaults it to CLIENT", async () => {
  const { context, module } = await loadReview();
  try {
    openSimplifiedReview(module, {
      kind: "REQUEST",
      sourceText: "مطلوب شقة شراء في العزيزية بميزانية 650000"
    });
    const role = context.document.querySelector('[name="advertiserRole"]');
    assert.ok(role, "unified review must keep advertiser role in the same form");
    assert.equal(role.value, "CLIENT");
  } finally {
    context.close();
  }
});

test("unified direct-owner OFFER review defaults advertiser role to OWNER", async () => {
  const { context, module } = await loadReview();
  try {
    openSimplifiedReview(module, {
      kind: "OFFER",
      sourceText: "للبيع شقة في العزيزية بسعر 650000 مالك مباشر",
      directOwner: true
    });
    const role = context.document.querySelector('[name="advertiserRole"]');
    assert.ok(role, "unified review must keep advertiser role in the same form");
    assert.equal(role.value, "OWNER");
  } finally {
    context.close();
  }
});

test("ambiguous unified OFFER review keeps an explicit role choice instead of silently persisting UNKNOWN", async () => {
  const { context, module } = await loadReview();
  try {
    openSimplifiedReview(module, {
      kind: "OFFER",
      sourceText: "للبيع شقة في العزيزية بسعر 650000"
    });
    const role = context.document.querySelector('[name="advertiserRole"]');
    assert.ok(role, "ambiguous offers need a role control in the unified form");
    assert.equal(role.value, "");
    assert.ok(Array.from(role.options).some((option) => option.value === "OWNER"));
    assert.ok(Array.from(role.options).some((option) => option.value === "DELEGATE"));
    assert.ok(Array.from(role.options).some((option) => option.value === "BROKER"));
  } finally {
    context.close();
  }
});
