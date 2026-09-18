from pathlib import Path
import re

path = Path("public/js/office-settings.js")
source = path.read_text()
replacement = '''async function shareOfficeLinkCard() {
  const missing = officeShareCardRequiredFields();
  if (missing.length) {
    setStatus(el.linkStatus, `أكمل بيانات المكتب أولًا: ${missing.join("، ")}`, "is-error");
    return;
  }
  const originalText = el.shareLinkCard?.textContent || "مشاركة رابط المكتب";
  const requestedSlug = normalizePublicSlug(el.publicSlug?.value || current.publicSlug);
  const persistedSlug = normalizePublicSlug(current.publicSlug);
  if (el.shareLinkCard) el.shareLinkCard.disabled = true;

  try {
    if (requestedSlug && requestedSlug === persistedSlug && navigator.share) {
      const text = officeShareMessage({
        officeName: current.officeName,
        origin: window.location.origin,
        publicSlug: current.publicSlug,
        officeId: officeId()
      });
      // Invoke Web Share before any await so the click keeps transient user activation.
      const sharePromise = navigator.share({ title: current.officeName, text });
      void (async () => {
        try {
          const blob = await createOfficeSharePreviewBlob();
          if (blob) await uploadOfficeSharePreview(blob);
        } catch (cardError) {
          console.warn("[iaqar] office share card upload", cardError);
        }
      })();
      await sharePromise;
      setStatus(el.linkStatus, "تمت مشاركة رابط المكتب", "is-done");
      return;
    }

    await ensurePublicSlug();
    const text = officeShareMessage({
      officeName: current.officeName,
      origin: window.location.origin,
      publicSlug: current.publicSlug,
      officeId: officeId()
    });
    try {
      const blob = await createOfficeSharePreviewBlob();
      if (blob) await uploadOfficeSharePreview(blob);
    } catch (cardError) {
      console.warn("[iaqar] office share card upload", cardError);
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      if (el.link) {
        el.link.select();
        document.execCommand("copy");
      }
    }
    setStatus(
      el.linkStatus,
      requestedSlug !== persistedSlug
        ? "تم حفظ الرابط ونسخه. اضغط مشاركة رابط المكتب مرة أخرى لفتح خيارات المشاركة."
        : "تم نسخ رسالة الرابط القصير",
      "is-done"
    );
    toast("تم نسخ رابط المكتب");
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (error && error.name === "NotAllowedError") {
      await copyLink();
      setStatus(el.linkStatus, "تعذر فتح المشاركة في هذا المتصفح، ونُسخ الرابط بدلًا منها.", "is-done");
      return;
    }
    setStatus(el.linkStatus, error?.message || "تعذر مشاركة رابط المكتب", "is-error");
  } finally {
    if (el.shareLinkCard) {
      el.shareLinkCard.disabled = false;
      el.shareLinkCard.textContent = originalText;
    }
  }
}

async function shareOfficeCard()'''
pattern = r"async function shareOfficeLinkCard\(\) \{.*?\n\}\n\nasync function shareOfficeCard\(\)"
patched, count = re.subn(pattern, lambda _: replacement, source, count=1, flags=re.S)
if count == 0:
    if "const sharePromise = navigator.share({ title: current.officeName, text });" not in source:
        raise SystemExit("shareOfficeLinkCard block not found")
    patched = source
path.write_text(patched)

start = patched.index("async function shareOfficeLinkCard()")
end = patched.index("async function shareOfficeCard()", start)
block = patched[start:end]
assert "const sharePromise = navigator.share({ title: current.officeName, text });" in block
assert block.index("navigator.share") < block.index("await ensurePublicSlug()")
assert "NotAllowedError" in block
print("office share gesture patch verified")
