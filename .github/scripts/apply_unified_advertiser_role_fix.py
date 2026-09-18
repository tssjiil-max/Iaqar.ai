from pathlib import Path

path = Path("public/js/opportunity-review.js")
text = path.read_text(encoding="utf-8")

if 'class="review-field import-advertiser-role-field"' in text:
    print("Unified advertiser-role control already present")
    raise SystemExit(0)

phone_block = '''  const localPhone = defaults.advertiserPhoneNormalized
    ? e164ToLocalInput(defaults.advertiserPhoneNormalized)
    : (advertiserCandidates.length === 1
      ? e164ToLocalInput(advertiserCandidates[0].advertiserPhoneNormalized)
      : "");
'''

role_setup = '''  const localPhone = defaults.advertiserPhoneNormalized
    ? e164ToLocalInput(defaults.advertiserPhoneNormalized)
    : (advertiserCandidates.length === 1
      ? e164ToLocalInput(advertiserCandidates[0].advertiserPhoneNormalized)
      : "");
  const inferredAdvertiserRole = inferAdvertiserRoleForOpportunity({
    opportunityKind: defaults.opportunityKind,
    existing: defaults.advertiserRole
      || activeDraft?.fields?.advertiserRole
      || activeDraft?.prepared?.opportunity?.advertiserRole
      || "",
    directOwner: activeDraft?.fields?.directOwner
      ?? activeDraft?.prepared?.fields?.directOwner
      ?? activeDraft?.prepared?.opportunity?.directOwner,
    sourceText: activeDraft?.sourceText || "",
    rawText: activeDraft?.prepared?.opportunity?.rawText || ""
  });
  const selectedAdvertiserRole = inferredAdvertiserRole === "UNKNOWN" ? "" : inferredAdvertiserRole;
  const advertiserRoleOptions = ADVERTISER_ROLES
    .filter((item) => item.id !== "UNKNOWN")
    .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedAdvertiserRole ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
    .join("");
'''

if phone_block not in text:
    raise SystemExit("simplified review local-phone block not found")
text = text.replace(phone_block, role_setup, 1)

phone_markup = '''      <label class="review-field import-phone-field">
        <span>${reviewLabel("phone", "رقم الجوال", needs)}</span>
        <input name="advertiserPhoneLocal" type="tel" inputmode="numeric" maxlength="10"
          placeholder="05XXXXXXXX" value="${escapeHtml(localPhone)}"
          aria-label="رقم جوال المعلن أو العميل" autocomplete="off">
        <small class="advertiser-extracted-hint" id="advertiserPhoneExtractedHint"
          ${advertiserExtractedAuto && localPhone ? "" : "hidden"}>تم استخراجه من الإعلان</small>
      </label>
      ${importExtraFieldsMarkup(defaults.importExtraFields || {})}
'''

role_markup = '''      <label class="review-field import-phone-field">
        <span>${reviewLabel("phone", "رقم الجوال", needs)}</span>
        <input name="advertiserPhoneLocal" type="tel" inputmode="numeric" maxlength="10"
          placeholder="05XXXXXXXX" value="${escapeHtml(localPhone)}"
          aria-label="رقم جوال المعلن أو العميل" autocomplete="off">
        <small class="advertiser-extracted-hint" id="advertiserPhoneExtractedHint"
          ${advertiserExtractedAuto && localPhone ? "" : "hidden"}>تم استخراجه من الإعلان</small>
      </label>
      <label class="review-field import-advertiser-role-field">
        <span>صفة الطرف</span>
        <select name="advertiserRole" aria-label="صفة المعلن أو العميل">
          <option value="">اختر الصفة</option>
          ${advertiserRoleOptions}
        </select>
      </label>
      ${importExtraFieldsMarkup(defaults.importExtraFields || {})}
'''

if phone_markup not in text:
    raise SystemExit("simplified review phone markup not found")
text = text.replace(phone_markup, role_markup, 1)

path.write_text(text, encoding="utf-8")
print("Applied unified advertiser-role control")
