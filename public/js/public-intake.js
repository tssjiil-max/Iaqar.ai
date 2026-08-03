(() => {
  "use strict";

  const WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
  const params = new URLSearchParams(location.search);
  const officeId = String(params.get("office") || params.get("officeId") || params.get("o") || "").trim();
  const isPublicLink = officeId && params.get("dashboard") !== "1";
  if (!isPublicLink) return;

  function esc(value) {
    return String(value || "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  }

  function render() {
    document.body.innerHTML = `
      <main class="public-intake-page" dir="rtl">
        <section class="public-intake-card">
          <h1>إرسال طلب إلى المكتب</h1>
          <p class="public-intake-lead">اختر نوع الطلب، ثم أرسل بياناتك مباشرة للمكتب.</p>

          <div class="public-intake-tabs" role="tablist">
            <button type="button" class="active" data-kind="client">أنا عميل</button>
            <button type="button" data-kind="owner">أنا مالك</button>
          </div>

          <form id="publicIntakeForm" autocomplete="on">
            <input type="hidden" id="intakeKind" value="client">
            <div class="public-intake-grid">
              <label><span>الاسم</span><input id="intakeName" maxlength="80" required></label>
              <label><span>رقم الجوال</span><input id="intakePhone" inputmode="tel" maxlength="20" placeholder="05xxxxxxxx" required></label>
              <label><span>نوع العقار</span>
                <select id="intakePropertyType" required>
                  <option value="">اختر</option><option>شقة</option><option>فيلا</option><option>دور</option><option>عمارة</option><option>أرض سكنية</option><option>أرض تجارية</option><option>محل</option><option>مكتب</option><option>مزرعة</option><option>استراحة</option><option>أخرى</option>
                </select>
              </label>
              <label><span>الحي</span><select id="intakeDistrict" required><option value="">اختر الحي</option><option>العزيزية</option><option>السلام</option><option>الدفاع</option><option>الجرف</option><option>قباء</option><option>العوالي</option><option>شوران</option><option>الهجرة</option><option>العريض</option><option>الجامعة</option><option>القبلتين</option><option>أحد</option><option>الخالدية</option><option>الفتح</option><option>الزهرة</option><option>الرانوناء</option><option>الحرة الشرقية</option><option>الحرة الغربية</option><option>البدراني</option><option>الدويمة</option><option>الدعيثة</option><option>العيون</option><option>الغابة</option><option>السد</option><option>السيح</option><option>المبعوث</option><option>المطار</option><option>النخيل</option><option>الربوة</option><option>الإسكان</option><option>الملك فهد</option><option>النصر</option><option>طيبة</option><option>الأزهري</option><option>المستراح</option><option>سيد الشهداء</option><option>جبل أحد</option><option>مهزور</option><option>ورقان</option><option>أبيار علي</option><option>ذو الحليفة</option><option>وادي العقيق</option><option>السكب</option><option>الروابي</option><option>القصواء</option><option>الخاتم</option><option>البركة</option><option>المصانع</option><option>السحمان</option><option>بني حارثة</option><option>قرب الحرم</option><option>البيداء</option><option>الجابرة</option><option>الجمعة</option><option>الراية</option><option>الشيبية</option><option>الشهباء</option><option>الصادقية</option><option>العالية</option><option>العنبرية</option><option>عروة</option><option>وعيرة</option><option>الفيصلية</option><option>المتنزه</option><option>المغيسلة</option><option>المهدية</option><option>النواعم</option><option>الهدراء</option><option>الوبرة</option><option>باقدو</option><option>تلعة الهبوب</option><option>جبل عير</option><option>حمراء الأسد</option></select></label>
              <label class="full"><span id="intakeAmountLabel">الميزانية التقريبية</span><input id="intakeAmount" inputmode="numeric" maxlength="16" placeholder="بالريال"></label>
              <label class="full"><span>التفاصيل</span><textarea id="intakeDetails" maxlength="1000" rows="4" placeholder="اكتب المواصفات أو تفاصيل العقار"></textarea></label>
              <label class="public-hp" aria-hidden="true"><span>اتركه فارغًا</span><input id="intakeWebsite" tabindex="-1" autocomplete="off"></label>
            </div>
            <button class="public-intake-submit" id="publicIntakeSubmit" type="submit">إرسال الطلب للمكتب</button>
            <p id="publicIntakeStatus" class="public-intake-status" aria-live="polite"></p>
          </form>
        </section>
      </main>`;

    const style = document.createElement("style");
    style.textContent = `
      body{margin:0;background:#f5f8f6;font-family:Tahoma,Arial,sans-serif;color:#173f38}
      .public-intake-page{min-height:100vh;display:grid;place-items:center;padding:22px;box-sizing:border-box}
      .public-intake-card{width:min(100%,520px);background:#fff;border:1px solid #d9e7e2;border-radius:28px;padding:26px;box-shadow:0 14px 40px rgba(0,75,69,.10);box-sizing:border-box}
      .public-intake-brand{color:#128c7e;font-weight:900;font-size:18px}.public-intake-card h1{font-size:28px;margin:10px 0 6px}.public-intake-lead{margin:0 0 20px;color:#6a7773;line-height:1.8}
      .public-intake-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#edf5f2;padding:6px;border-radius:18px;margin-bottom:20px}.public-intake-tabs button{border:0;border-radius:14px;padding:13px;font-weight:800;font-size:16px;background:transparent;color:#36655d}.public-intake-tabs button.active{background:#128c7e;color:#fff}
      .public-intake-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.public-intake-grid label{display:grid;gap:7px;font-weight:700}.public-intake-grid label.full{grid-column:1/-1}.public-intake-grid input,.public-intake-grid select,.public-intake-grid textarea{width:100%;box-sizing:border-box;border:1px solid #cbdcd6;border-radius:14px;padding:13px;background:#fff;font:inherit;outline:none}.public-intake-grid input:focus,.public-intake-grid select:focus,.public-intake-grid textarea:focus{border-color:#128c7e;box-shadow:0 0 0 3px rgba(18,140,126,.12)}
      .public-intake-submit{width:100%;border:0;border-radius:16px;background:#128c7e;color:#fff;padding:15px;font-size:17px;font-weight:900;margin-top:18px}.public-intake-submit:disabled{opacity:.6}.public-intake-status{text-align:center;min-height:24px;margin:12px 0 0;font-weight:700}.public-hp{position:absolute!important;left:-10000px!important}
      @media(max-width:520px){.public-intake-page{padding:12px}.public-intake-card{padding:20px;border-radius:24px}.public-intake-grid{grid-template-columns:1fr}.public-intake-grid label.full{grid-column:auto}}
    `;
    document.head.appendChild(style);

    const tabs = [...document.querySelectorAll("[data-kind]")];
    tabs.forEach(btn => btn.addEventListener("click", () => {
      tabs.forEach(x => x.classList.toggle("active", x === btn));
      document.getElementById("intakeKind").value = btn.dataset.kind;
      document.getElementById("intakeAmountLabel").textContent = btn.dataset.kind === "owner" ? "السعر المطلوب" : "الميزانية التقريبية";
      document.getElementById("publicIntakeSubmit").textContent = btn.dataset.kind === "owner" ? "إرسال عرض العقار" : "إرسال طلب العميل";
    }));

    document.getElementById("publicIntakeForm").addEventListener("submit", submit);
  }

  async function submit(event) {
    event.preventDefault();
    const status = document.getElementById("publicIntakeStatus");
    const button = document.getElementById("publicIntakeSubmit");
    if (document.getElementById("intakeWebsite").value) return;
    const phone = document.getElementById("intakePhone").value.replace(/[^0-9+]/g, "");
    if (phone.length < 9) { status.textContent = "تحقق من رقم الجوال."; return; }
    const payload = {
      officeId,
      kind: document.getElementById("intakeKind").value,
      name: document.getElementById("intakeName").value.trim(),
      phone,
      city: "المدينة المنورة",
      propertyType: document.getElementById("intakePropertyType").value,
      district: document.getElementById("intakeDistrict").value.trim(),
      amount: Number(document.getElementById("intakeAmount").value.replace(/[^0-9]/g, "")) || 0,
      details: document.getElementById("intakeDetails").value.trim(),
      mediaPaths: [],
      imageCount: 0,
      hasVideo: false,
      mediaMissing: document.getElementById("intakeKind").value === "owner",
      completeness: document.getElementById("intakeKind").value === "owner" ? 65 : 80,
      source: "office_public_link",
      status: "new",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    button.disabled = true; status.textContent = "جاري الإرسال...";
    try {
      const runtime = window.IAQAR && window.IAQAR.office;
      if (!runtime || !runtime.db) throw new Error("تعذر الاتصال");
      const ref = await runtime.db.collection("offices").doc(officeId).collection("publicIntake").add(payload);
      let matchingResult = null;
      try {
        const response = await fetch(`${WORKER_BASE}/pipeline/public-intake`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ officeId, intakeId: ref.id })
        });
        matchingResult = await response.json().catch(() => ({}));
        if (!response.ok) matchingResult = null;
      } catch (matchingError) { console.warn("[iaqar] matching queued", matchingError); }
      event.target.reset();
      document.getElementById("intakeKind").value = "client";
      document.querySelectorAll("[data-kind]").forEach(btn => btn.classList.toggle("active", btn.dataset.kind === "client"));
      document.getElementById("intakeAmountLabel").textContent = "الميزانية التقريبية";
      document.getElementById("publicIntakeSubmit").textContent = "إرسال طلب العميل";
      status.textContent = matchingResult && Number(matchingResult.matches || 0) > 0
        ? `تم الإرسال واكتشاف ${matchingResult.matches} مطابقة مناسبة.`
        : "تم إرسال البيانات للمكتب وتشغيل المطابقة تلقائيًا.";
    } catch (error) {
      console.error("[iaqar] public intake", error);
      status.textContent = "تعذر الإرسال الآن. حاول مرة أخرى.";
    } finally { button.disabled = false; }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
