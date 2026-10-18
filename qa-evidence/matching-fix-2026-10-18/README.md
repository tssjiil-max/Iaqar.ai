# Matching fix — evidence (2026-10-18)

Local Worker + in-memory Firestore, isolated QA offices, no WhatsApp sent.

| File | What it shows |
|---|---|
| `before-390-range-request.png` | Staging before the fix: «من 2,500,000 إلى 3,500,000» read as «حتى 2,500,000», «القريبة» shown as a district, **0 results** although a published 3,000,000 building exists |
| `after-390-range-request.png` | Same text after the fix: «من 2,500,000 إلى 3,500,000 ريال», «والأحياء القريبة» as a wish, «مساحة 500 م² فأكثر», the published building found |
| `after-390-published-offer-found.png` | Guest desk: the published building shown, the one awaiting review not shown |
| `after-390-request-receipt.png` | Request receipt: short reference, office name, «محفوظ في بنك الطلبات · بانتظار مراجعة المكتب», «وصل المكتبَ تنبيه», no contact promise |
| `guest-desk-proof.json` → `rangeScenario` | Summary text, results shown, the review offer hidden, request reference and the office bank record with `priceMin` 2,500,000 / `priceMax` 3,500,000 / `area` 500 |

The full lifecycle (pending review → published → found → matched in the office → unpublished → gone; resubmission;
same results from page, office link, inventory enquiry and WhatsApp) is `test/office-os-matching-lifecycle.test.mjs`.
