from pathlib import Path

path = Path("public/js/add-opportunity.js")
text = path.read_text(encoding="utf-8")

if "function buildApprovedAdvertiserReviewPatch" in text:
    print("Approved-readiness helper already present")
    raise SystemExit(0)

marker = '''async function approveFromReview(brokerExtras, review, advertiser = {}) {'''
helper = '''function buildApprovedAdvertiserReviewPatch(baseOpportunity = {}, advertiser = {}) {
  const merged = mergeAdvertiserFieldsIntoOpportunity(baseOpportunity, advertiser);
  const keys = [
    "advertiserDisplayName",
    "advertiserPhoneRaw",
    "advertiserPhoneNormalized",
    "advertiserPhoneSource",
    "advertiserPhoneEvidence",
    "advertiserRole",
    "advertiserContactStatus",
    "marketingConsentStatus",
    "lastContactAt",
    "contactNotes",
    "contactPhone",
    "matchingReadiness",
    "matchingReadinessMissing"
  ];
  return Object.fromEntries(
    keys.filter((key) => Object.prototype.hasOwnProperty.call(merged, key))
      .map((key) => [key, merged[key]])
  );
}

async function approveFromReview(brokerExtras, review, advertiser = {}) {'''
if marker not in text:
    raise SystemExit("approveFromReview marker not found")
text = text.replace(marker, helper, 1)

old = '''    const reviewMeta = {
      reviewOperationTypeId: brokerExtras.reviewOperationTypeId || "",
      reviewPropertyTypeId: brokerExtras.reviewPropertyTypeId || "",
      reviewCityId: brokerExtras.reviewCityId || "",
      reviewDistrictId: brokerExtras.reviewDistrictId || "",
      extractedSnapshot: brokerExtras.extractedSnapshot || null,
      ...mergeAdvertiserFieldsIntoOpportunity({}, advertiser)
    };
'''
new = '''    const approvedAdvertiserPatch = buildApprovedAdvertiserReviewPatch({
      ...prepared.opportunity,
      ...brokerFields,
      sourceText: intakeContext.listingText || intakeContext.inputText || prepared.opportunity?.sourceText || "",
      rawText: prepared.opportunity?.rawText || intakeContext.listingText || intakeContext.inputText || "",
      directOwner: prepared.opportunity?.directOwner ?? prepared.fields?.directOwner
    }, advertiser);

    const reviewMeta = {
      reviewOperationTypeId: brokerExtras.reviewOperationTypeId || "",
      reviewPropertyTypeId: brokerExtras.reviewPropertyTypeId || "",
      reviewCityId: brokerExtras.reviewCityId || "",
      reviewDistrictId: brokerExtras.reviewDistrictId || "",
      extractedSnapshot: brokerExtras.extractedSnapshot || null,
      ...approvedAdvertiserPatch
    };
'''
if old not in text:
    raise SystemExit("reviewMeta advertiser merge block not found")
text = text.replace(old, new, 1)

old_export = '''  buildOpportunityPersistPayload,
  sanitizeFirestoreWrite,'''
new_export = '''  buildOpportunityPersistPayload,
  buildApprovedAdvertiserReviewPatch,
  sanitizeFirestoreWrite,'''
if old_export not in text:
    raise SystemExit("__test export marker not found")
text = text.replace(old_export, new_export, 1)

path.write_text(text, encoding="utf-8")
print("Applied approved matching-readiness persistence patch")
