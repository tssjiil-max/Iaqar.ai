(() => {
  "use strict";

  const query = new URLSearchParams(location.search);
  let officeId = String(query.get("officeId") || query.get("office") || "")
    .trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 80);
  let isPublicOfficeLink = query.get("view") === "public" && officeId && officeId !== "platform";
  let isPlatformHome = !officeId || officeId === "platform";
  const publicSlug = (() => {
    const match = location.pathname.match(/^\/o\/([^/]+)\/?$/i);
    if (!match) return "";
    try { return decodeURIComponent(match[1]).trim().toLowerCase(); } catch (_) { return match[1].trim().toLowerCase(); }
  })();
  function refreshRouteFlags() {
    isPublicOfficeLink = Boolean(officeId && officeId !== "platform" && (query.get("view") === "public" || publicSlug));
    isPlatformHome = !officeId || officeId === "platform";
  }
  const gate = document.createElement("main");
  const WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
  const PROPERTY_TYPES = Object.freeze([
    "شقة", "فيلا", "دور", "دوبلكس", "عمارة", "أرض سكنية", "أرض تجارية",
    "محل تجاري", "مكتب", "مستودع", "استراحة", "مزرعة", "قصر", "بيت شعبي",
    "مجمع سكني", "مجمع تجاري"
  ]);
  const MADINAH_DISTRICTS = Object.freeze([
    "أبيار علي", "أبو بريقاء", "أبو سدر", "أحد", "الإسكان", "الأزهري", "الأصيفرين",
    "البدراني", "البركة", "البيداء", "الجامعة", "الجابرة", "الجصة", "الجماوات", "الجرف",
    "الجمعة", "الحرم الشريف", "الحساء", "الحديقة", "الخاتم", "الخالدية", "الدفاع", "الدعيثة",
    "الدويمة", "الراية", "الربوة", "الرانوناء", "الرمانة", "الروابي", "السحمان", "السد",
    "السلام", "السكب", "السيح", "الشريبات", "الشهباء", "الصادقية", "الصويدرة", "العالية",
    "العريض", "العزيزية", "العصبة", "العهن", "العنبرية", "العيون", "الغراء", "الفيصلية",
    "الفريش", "الفتح", "القصواء", "القبلتين", "المبعوث", "المطار", "المصانع", "المستراح",
    "المتنزه", "المزيين", "المغيسلة", "المفرحات", "المهدية", "المناخة", "الملك فهد",
    "النخيل", "النصر", "النقاء", "النقمى", "النواعم", "الهدراء", "الهجرة", "الوبرة",
    "باقدو", "بضاعة", "بني بياضة", "بني حارثة", "بني ظفر", "بني النجار", "تلعة الهبوب",
    "جبل أحد", "جبل عير", "جماء أم خالد", "جشم", "حرة الوبرة", "حمراء الأسد", "حزرة الجنوب",
    "ذو الحليفة", "رهط", "سد الغابة", "سكة الحديد", "سيد الشهداء", "شوران", "طيبة", "عروة",
    "عين الخيف", "قربان", "نبلاء", "وادي العقيق", "وادي مذينب", "وادي مهزور", "ورقان", "وعيرة"
  ]);

  document.head.insertAdjacentHTML("beforeend", `<style>
    body.access-locked{overflow-y:auto!important;height:auto!important;min-height:100%!important;background:#f4f8f6;
      overscroll-behavior-y:contain}body.access-locked>.app{display:none!important}
    .access-gate{min-height:100svh;padding:18px 18px calc(40px + env(safe-area-inset-bottom));box-sizing:border-box;display:flex;justify-content:center;
      background:#f4f8f6;color:#173d35;font-family:Tajawal,Arial,sans-serif;direction:rtl}
    .access-shell{width:min(100%,460px)}.access-brand,.access-card{background:#fff;border:1px solid #dce8e4;
      border-radius:24px;padding:20px;margin-bottom:12px}.access-brand{text-align:center}
    .access-brand img{width:76px;height:76px;object-fit:contain}.access-brand h1{margin:7px 0 2px;color:#087064;font-size:24px}
    .access-brand p,.access-card p{color:#687c76;font-size:14px;line-height:1.7;margin:0 0 14px}
    .access-card h2{color:#087064;font-size:21px;margin:0 0 6px}.access-options{display:grid;gap:10px}
    .access-btn{min-height:56px;border:0;border-radius:16px;padding:11px 15px;background:#128c7e;color:#fff;
      font:800 17px Tajawal;cursor:pointer}.access-btn.secondary{background:#fff;color:#087064;border:1.5px solid #128c7e}
    .access-btn.light{background:#eaf7f3;color:#087064}.access-btn:disabled{opacity:.55}
    .access-back{border:0;background:none;color:#087064;font:700 14px Tajawal;margin:0 0 8px;cursor:pointer}
    .access-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.access-form label{display:grid;gap:5px;
      font-size:13px;font-weight:700;color:#36574f}.access-form .full{grid-column:1/-1}
    .access-form input,.access-form select,.access-form textarea{box-sizing:border-box;width:100%;border:1px solid #d4e3de;border-radius:14px;
      padding:12px;font:500 15px Tajawal;background:#fff}.access-form textarea{min-height:86px;resize:vertical}
    .access-form .conditional-field[hidden]{display:none}
    .file-help{font-size:12px!important;color:#71817d!important;margin:0!important}.access-status{display:none;margin-top:11px;
      padding:11px;border-radius:13px;font-size:14px;line-height:1.6}.access-status.show{display:block}
    .access-status.ok{background:#e8f7f2;color:#07634f}.access-status.err{background:#fff0f0;color:#9e3434}
    .access-note{text-align:center;color:#71817d;font-size:12px;line-height:1.7;margin-top:12px}
    @media(max-width:420px){.access-form{grid-template-columns:1fr}.access-form .full{grid-column:auto}}
  </style>`);

  gate.className = "access-gate";
  document.body.classList.add("access-locked");
  document.body.appendChild(gate);

  const logo = document.querySelector(".site-logo img,.brand-logo img,.office-logo img");
  const logoSrc = logo ? logo.src : "/icons/icon-192.png";
  const db = () => firebase.firestore();
  const optionList = values => values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  const normalizeSaudiPhone = value => {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("00966")) digits = digits.slice(2);
    if (digits.startsWith("966")) digits = `0${digits.slice(3)}`;
    if (digits.startsWith("5") && digits.length === 9) digits = `0${digits}`;
    return /^05\d{8}$/.test(digits) ? digits : "";
  };
  const validFullName = value => String(value || "").trim().split(/\s+/).filter(Boolean).length >= 2;

  async function uploadPublicMedia({ file, targetOffice, intakeId, kind, index = 0 }) {
    const response = await fetch(`${WORKER_BASE}/media/public-intake`, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "X-Office-Id": targetOffice,
        "X-Intake-Id": intakeId,
        "X-Media-Kind": kind,
        "X-Media-Index": String(index)
      },
      body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.mediaPath) throw new Error(result.error || "MEDIA_UPLOAD_FAILED");
    return result.mediaPath;
  }


  async function triggerPublicIntakeMatching(targetOffice, intakeId) {
    const response = await fetch(`${WORKER_BASE}/pipeline/public-intake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeId: targetOffice, intakeId })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "MATCHING_FAILED");
    return result;
  }

  function frame(content) {
    gate.innerHTML = `<div class="access-shell"><section class="access-brand">
      <img src="${logoSrc}" alt="مكاتب عقارية ذكية"><h1>مكاتب عقارية ذكية</h1>
      <p>منصة تشغيل الوسطاء العقاريين</p></section>${content}</div>`;
  }
  function showStatus(message, ok = false) {
    const node = gate.querySelector("#accessStatus");
    if (!node) return;
    node.textContent = message;
    node.className = `access-status show ${ok ? "ok" : "err"}`;
  }
  function home() {
    frame(`<section class="access-card"><h2>اختر الخدمة</h2>
      <p>رفع الطلب مباشر للعميل والمالك، وتسجيل الوسيط يخضع لمراجعة رخصة فال واعتماد الإدارة.</p>
      <div class="access-options">
        <button class="access-btn" data-go="client">أنا عميل</button>
        <button class="access-btn secondary" data-go="owner">أنا مالك عقار</button>
        <button class="access-btn light" data-go="broker">تسجيل وسيط عقاري</button>
        <button class="access-btn secondary" data-go="login">دخول مكتب مسجل</button>
      </div><div class="access-note">الصفحة العامة لا تعرض بيانات أي مكتب أو إعداداته.</div></section>`);
    gate.querySelectorAll("[data-go]").forEach(button => button.onclick = () => {
      if (button.dataset.go === "broker") brokerForm();
      else if (button.dataset.go === "login") loginForm();
      else intakeForm(button.dataset.go, "platform");
    });
  }
  async function publicOffice() {
    frame(`<section class="access-card"><h2>خدمات المكتب</h2>
      <p>ارفع طلبك مباشرة دون تسجيل، ولا يمكن للزائر الوصول إلى مساحة المكتب أو إعداداته.</p>
      <div id="publicOfficeProfile"></div>
      <div class="access-options"><button class="access-btn" data-go="client">أنا عميل</button>
      <button class="access-btn secondary" data-go="owner">أنا مالك عقار</button>
      <button class="access-btn light" id="publicHome">المنصة العامة</button></div></section>`);
    gate.querySelectorAll("[data-go]").forEach(button => button.onclick = () => intakeForm(button.dataset.go, officeId));
    gate.querySelector("#publicHome").onclick = () => location.assign("/");
    try {
      const snap = await db().collection("publicOffices").doc(officeId).get();
      if (snap.exists) {
        const data = snap.data() || {};
        gate.querySelector("#publicOfficeProfile").innerHTML = `
          ${data.coverUrl ? `<img src="${escapeHtml(data.coverUrl)}" alt="صورة المكتب" style="width:100%;height:180px;object-fit:cover;border-radius:16px;margin-bottom:10px">` : ""}
          <h2>${escapeHtml(data.officeName || "مكتب عقاري")}</h2>
          <p>${escapeHtml(data.brokerName || "وسيط عقاري")} — رخصة فال ${escapeHtml(data.licenseNumber || "—")}
          <br>${escapeHtml(data.city || "")}${data.phone ? ` — تواصل ${escapeHtml(data.phone)}` : ""}${data.whatsapp ? ` — واتساب ${escapeHtml(data.whatsapp)}` : ""}</p>`;
      }
    } catch (_) {}
  }
  function intakeForm(kind, targetOffice) {
    const owner = kind === "owner";
    frame(`<section class="access-card"><button class="access-back">← رجوع</button>
      <h2>${owner ? "إضافة عرض مالك" : "إضافة طلب عميل"}</h2>
      <p>لا يحتاج هذا النموذج إلى إنشاء حساب.</p>
      <form class="access-form" id="intakeForm">
        <label><span>الاسم الثنائي على الأقل (إلزامي)</span><input name="name" maxlength="80" required></label>
        <label><span>رقم الجوال (إلزامي)</span><input name="phone" inputmode="tel" maxlength="20" required></label>
        <label><span>نوع العقار</span><select name="propertyType" id="propertyTypeSelect">
          <option value="">اختر نوع العقار</option>${optionList(PROPERTY_TYPES)}<option value="__other__">أخرى</option>
        </select></label>
        <label><span>الحي</span><select name="district" id="districtSelect">
          <option value="">اختر الحي</option>${optionList(MADINAH_DISTRICTS)}<option value="__other__">حي جديد / غير موجود</option>
        </select></label>
        <label class="conditional-field full" id="otherPropertyWrap" hidden><span>اكتب نوع العقار</span>
          <input name="otherPropertyType" maxlength="40"></label>
        <label class="conditional-field full" id="otherDistrictWrap" hidden><span>اكتب اسم الحي الجديد</span>
          <input name="otherDistrict" maxlength="80"></label>
        <label class="full"><span>تفاصيل إضافية</span><textarea name="details" maxlength="1000"></textarea></label>
        ${owner ? `<label class="full"><span>صور العقار (اختياري، حتى 5 صور)</span>
          <input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple>
          <p class="file-help">يمكن إرسال العرض دون صور، ويطلبها الوسيط لاحقًا عبر واتساب. بحد أقصى 8 ميجابايت للصورة.</p></label>
          <label class="full"><span>فيديو العقار (اختياري)</span>
          <input name="video" type="file" accept="video/mp4,video/webm,video/quicktime">
          <p class="file-help">فيديو واحد بحد أقصى 90 ميجابايت.</p></label>` : ""}
        <label class="full"><button class="access-btn" type="submit">${owner ? "إرسال العرض" : "إرسال الطلب"}</button></label>
      </form><div id="accessStatus" class="access-status"></div></section>`);
    gate.querySelector(".access-back").onclick = isPublicOfficeLink ? publicOffice : home;
    const propertySelect = gate.querySelector("#propertyTypeSelect");
    const districtSelect = gate.querySelector("#districtSelect");
    const otherPropertyWrap = gate.querySelector("#otherPropertyWrap");
    const otherDistrictWrap = gate.querySelector("#otherDistrictWrap");
    const toggleOther = (select, wrap) => {
      const visible = select.value === "__other__";
      wrap.hidden = !visible;
      const input = wrap.querySelector("input");
      input.required = visible;
      if (!visible) input.value = "";
      if (visible) setTimeout(() => input.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    };
    propertySelect.onchange = () => toggleOther(propertySelect, otherPropertyWrap);
    districtSelect.onchange = () => toggleOther(districtSelect, otherDistrictWrap);
    gate.querySelectorAll("input,select,textarea").forEach(field => field.addEventListener("focus", () => {
      setTimeout(() => field.scrollIntoView({ behavior: "smooth", block: "center" }), 180);
    }));
    gate.querySelector("#intakeForm").onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      const name = String(fields.get("name") || "").trim().replace(/\s+/g, " ");
      if (!validFullName(name)) return showStatus("أدخل الاسم الثنائي على الأقل.");
      const phone = normalizeSaudiPhone(fields.get("phone"));
      if (!phone) return showStatus("أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.");
      const images = owner ? Array.from(form.elements.images.files || []) : [];
      const video = owner ? form.elements.video.files[0] : null;
      if (owner && images.length > 5) return showStatus("يمكن إضافة 5 صور كحد أقصى.");
      if (images.some(file => file.size > 8 * 1024 * 1024)) return showStatus("إحدى الصور أكبر من 8 ميجابايت.");
      if (video && video.size > 90 * 1024 * 1024) return showStatus("الفيديو أكبر من 90 ميجابايت.");
      const submit = form.querySelector("button[type=submit]");
      submit.disabled = true;
      submit.textContent = owner ? "جارٍ رفع العرض..." : "جارٍ إرسال الطلب...";
      try {
        const ref = db().collection("offices").doc(targetOffice).collection("publicIntake").doc();
        const propertyType = String(fields.get("propertyType") || "") === "__other__"
          ? String(fields.get("otherPropertyType") || "").trim()
          : String(fields.get("propertyType") || "").trim();
        const district = String(fields.get("district") || "") === "__other__"
          ? String(fields.get("otherDistrict") || "").trim()
          : String(fields.get("district") || "").trim();
        const mediaPaths = [];
        if (owner) {
          for (let index = 0; index < images.length; index += 1) {
            mediaPaths.push(await uploadPublicMedia({
              file: images[index], targetOffice, intakeId: ref.id, kind: "image", index: index + 1
            }));
          }
          if (video) {
            mediaPaths.push(await uploadPublicMedia({
              file: video, targetOffice, intakeId: ref.id, kind: "video"
            }));
          }
        }
        await ref.set({
          officeId: targetOffice, kind,
          name,
          phone,
          city: "المدينة المنورة",
          propertyType,
          district,
          details: String(fields.get("details") || "").trim(),
          mediaPaths,
          imageCount: images.length,
          hasVideo: Boolean(video),
          mediaMissing: owner && images.length === 0,
          completeness: owner ? (images.length ? 90 : 65) : 80,
          source: targetOffice === "platform" ? "platform_public" : "office_public_link",
          status: "new",
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        let matchingResult = null;
        try { matchingResult = await triggerPublicIntakeMatching(targetOffice, ref.id); }
        catch (matchingError) { console.warn("[iaqar] matching queued", matchingError); }
        form.reset();
        if (matchingResult && Number(matchingResult.matches || 0) > 0) {
          showStatus(`تم الإرسال واكتشاف ${matchingResult.matches} مطابقة مناسبة.`, true);
        } else {
          showStatus(owner ? "تم رفع عرض العقار وتشغيل المطابقة." : "تم إرسال الطلب وتشغيل المطابقة.", true);
        }
      } catch (error) {
        console.warn("[iaqar] intake submit", error);
        showStatus("تعذر الإرسال الآن. تحقق من الاتصال وحاول مرة أخرى.");
      } finally {
        submit.disabled = false;
        submit.textContent = owner ? "إرسال العرض" : "إرسال الطلب";
      }
    };
  }
  function brokerForm() {
    frame(`<section class="access-card"><button class="access-back">← رجوع</button>
      <h2>تسجيل وسيط عقاري</h2><p>لن يُنشأ المكتب إلا بعد التحقق من رخصة فال واعتماد إدارة المنصة.</p>
      <form class="access-form" id="brokerForm">
        <label><span>اسم الوسيط *</span><input name="brokerName" maxlength="80" required></label>
        <label><span>رقم الجوال *</span><input name="phone" inputmode="tel" maxlength="20" required></label>
        <label><span>البريد الإلكتروني للاسترجاع *</span><input name="email" type="email" maxlength="120" required></label>
        <label><span>رقم رخصة فال *</span><input name="falLicense" inputmode="numeric" maxlength="20" required></label>
        <label class="full"><span>اسم المكتب المقترح *</span><input name="officeName" minlength="4" maxlength="80" required></label>
        <label class="full"><span>كلمة مرور الحساب *</span><input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
        <label class="full"><button class="access-btn" type="submit">إرسال طلب الاعتماد</button></label>
      </form><div id="accessStatus" class="access-status"></div></section>`);
    gate.querySelector(".access-back").onclick = home;
    gate.querySelector("#brokerForm").onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      const submit = form.querySelector("button[type=submit]");
      const brokerPhone = normalizeSaudiPhone(fields.get("phone"));
      if (!brokerPhone) return showStatus("أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.");
      submit.disabled = true;
      try {
        const credential = await firebase.auth().createUserWithEmailAndPassword(
          String(fields.get("email") || "").trim(),
          String(fields.get("password") || "")
        );
        const idToken = await credential.user.getIdToken();
        const response = await fetch(`${WORKER_BASE}/broker/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
          body: JSON.stringify({
          brokerName: String(fields.get("brokerName") || "").trim(),
          phone: brokerPhone,
          email: String(fields.get("email") || "").trim().toLowerCase(),
          falLicense: String(fields.get("falLicense") || "").replace(/\D/g, "").slice(0, 20),
          officeName: String(fields.get("officeName") || "").trim()
          })
        });
        if (!response.ok) throw new Error("APPLICATION_FAILED");
        await firebase.auth().signOut();
        form.reset();
        showStatus("تم استلام الطلب وحالته «بانتظار الاعتماد». ستتواصل الإدارة معك بعد التحقق من رخصة فال.", true);
      } catch (error) {
        console.warn("[iaqar] broker application", error);
        showStatus("تعذر إرسال الطلب الآن. تحقق من البيانات وحاول مرة أخرى.");
      } finally { submit.disabled = false; }
    };
  }
  function loginForm(message = "") {
    frame(`<section class="access-card"><button class="access-back">← رجوع</button>
      <h2>دخول المكتب</h2><p>مساحة العمل والإعدادات للحسابات المعتمدة والمصرح لها فقط.</p>
      <form class="access-form" id="loginForm">
        <label class="full"><span>رقم الجوال</span><input name="phone" inputmode="tel" autocomplete="username" required></label>
        <label class="full"><span>كلمة المرور</span><input name="password" type="password" autocomplete="current-password" required></label>
        <label class="full"><button class="access-btn light" type="button" id="togglePassword">إظهار كلمة المرور</button></label>
        <label class="full"><button class="access-btn" type="submit">تسجيل الدخول</button></label>
        <label class="full"><button class="access-btn light" type="button" id="forgotPassword">نسيت كلمة المرور</button></label>
        <label class="full"><button class="access-btn secondary" type="button" id="platformLogin">دخول إدارة المنصة</button></label>
      </form><div id="accessStatus" class="access-status ${message ? "show err" : ""}">${message}</div></section>`);
    gate.querySelector(".access-back").onclick = home;
    gate.querySelector("#togglePassword").onclick = event => {
      const input = gate.querySelector('input[name="password"]');
      input.type = input.type === "password" ? "text" : "password";
      event.currentTarget.textContent = input.type === "password" ? "إظهار كلمة المرور" : "إخفاء كلمة المرور";
    };
    gate.querySelector("#forgotPassword").onclick = forgotPasswordForm;
    gate.querySelector("#platformLogin").onclick = platformLoginForm;
    gate.querySelector("#loginForm").onsubmit = async event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const phone = normalizeSaudiPhone(fields.get("phone"));
      if (!phone) return showStatus("أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.");
      try {
        const response = await fetch(`${WORKER_BASE}/auth/phone-login`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, password: String(fields.get("password") || ""), apiKey: firebase.app().options.apiKey })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.customToken || !payload.officeId) throw new Error("LOGIN_FAILED");
        await firebase.auth().signInWithCustomToken(payload.customToken);
        await verifyAccess(payload.officeId, true);
      } catch (error) {
        console.warn("[iaqar] login", error);
        try { await firebase.auth().signOut(); } catch (_) {}
        showStatus("بيانات الدخول غير صحيحة أو الحساب غير مخوّل لهذا المكتب.");
      }
    };
  }
  function forgotPasswordForm() {
    frame(`<section class="access-card"><button class="access-back">← رجوع</button><h2>نسيت كلمة المرور</h2>
      <p>أدخل رقم الجوال، وسنرسل رابط إعادة تعيين كلمة المرور إلى البريد المسجل للحساب.</p>
      <form class="access-form" id="forgotForm"><label class="full"><span>رقم الجوال</span>
      <input name="phone" inputmode="tel" required></label><label class="full"><button class="access-btn" type="submit">إرسال رابط الاسترجاع</button></label></form>
      <div id="accessStatus" class="access-status"></div></section>`);
    gate.querySelector(".access-back").onclick = () => loginForm();
    gate.querySelector("#forgotForm").onsubmit = async event => {
      event.preventDefault();
      const phone = normalizeSaudiPhone(new FormData(event.currentTarget).get("phone"));
      if (!phone) return showStatus("أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.");
      const button = event.currentTarget.querySelector("button"); button.disabled = true;
      try {
        const response = await fetch(`${WORKER_BASE}/auth/forgot-password`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, apiKey: firebase.app().options.apiKey }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("RESET_FAILED");
        showStatus(payload.maskedEmail ? `تم إرسال الرابط إلى ${payload.maskedEmail}.` : "إذا كان الرقم مسجلًا فسيصل رابط الاسترجاع إلى البريد المرتبط به.", true);
      } catch (_) { showStatus("تعذر إرسال رابط الاسترجاع الآن. حاول بعد قليل."); }
      finally { button.disabled = false; }
    };
  }
  function platformLoginForm() {
    frame(`<section class="access-card"><button class="access-back">← رجوع</button><h2>دخول إدارة المنصة</h2>
      <p>هذا الدخول مخصص لمدير المنصة فقط.</p><form class="access-form" id="platformForm">
      <label class="full"><span>البريد الإلكتروني</span><input name="email" type="email" autocomplete="username" required></label>
      <label class="full"><span>كلمة المرور</span><input name="password" type="password" autocomplete="current-password" required></label>
      <label class="full"><button class="access-btn" type="submit">دخول الإدارة</button></label></form><div id="accessStatus" class="access-status"></div></section>`);
    gate.querySelector(".access-back").onclick = () => loginForm();
    gate.querySelector("#platformForm").onsubmit = async event => {
      event.preventDefault(); const fields = new FormData(event.currentTarget);
      try { await firebase.auth().signInWithEmailAndPassword(String(fields.get("email") || "").trim(), String(fields.get("password") || "")); await verifyAccess("platform", true); }
      catch (_) { try { await firebase.auth().signOut(); } catch (_) {} showStatus("بيانات إدارة المنصة غير صحيحة."); }
    };
  }
  async function verifyAccess(target, navigate) {
    if (!target) return loginForm("أدخل رمز المكتب المعتمد.");
    if (target === "platform") {
      try {
        const token = await firebase.auth().currentUser.getIdTokenResult(true);
        if (token.claims.platformAdmin === true || token.claims.admin === true) return adminApplications();
      } catch (_) {}
      return loginForm("هذا الحساب ليس من إدارة المنصة.");
    }
    try {
      await db().collection("offices").doc(target).get({ source: "server" });
      localStorage.setItem("iaqar.officeId", target);
      if (navigate || target !== officeId) return location.replace(`${location.pathname}?office=${encodeURIComponent(target)}`);
      document.body.classList.remove("access-locked");
      gate.remove();
    } catch (error) {
      console.warn("[iaqar] access denied", error);
      loginForm("هذا الحساب غير مخوّل للمكتب المطلوب.");
    }
  }

  async function adminApplications() {
    frame(`<section class="access-card"><h2>طلبات تسجيل الوسطاء</h2>
      <p>راجع رقم رخصة فال، ثم اعتمد الطلب أو ارفضه. لا يُنشأ المكتب قبل اعتمادك.</p>
      <div id="adminApplications"><p>جارٍ تحميل الطلبات...</p></div>
      <button class="access-btn light" id="enableAdminNotifications" style="width:100%;margin-top:12px">تفعيل إشعارات طلبات الوسطاء</button>
      <button class="access-btn secondary" id="adminLogout" style="width:100%;margin-top:12px">تسجيل الخروج</button>
      <div id="accessStatus" class="access-status"></div></section>`);
    gate.querySelector("#adminLogout").onclick = async () => { await firebase.auth().signOut(); home(); };
    const notificationButton = gate.querySelector("#enableAdminNotifications");
    notificationButton.onclick = () => enableAdminNotifications(true);
    if (localStorage.getItem("iaqar.fcm.enabled.platform") === "1") {
      notificationButton.textContent = "إشعارات الإدارة مفعّلة";
      if ("Notification" in window && Notification.permission === "granted") setTimeout(() => enableAdminNotifications(false), 200);
    }
    try {
      const token = await firebase.auth().currentUser.getIdToken();
      const response = await fetch(`${WORKER_BASE}/admin/broker-applications`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("LOAD_FAILED");
      const payload = await response.json();
      const list = Array.isArray(payload.applications) ? payload.applications : [];
      const container = gate.querySelector("#adminApplications");
      if (!list.length) {
        container.innerHTML = `<p>لا توجد طلبات معلّقة حاليًا.</p>`;
        return;
      }
      container.innerHTML = list.map(item => `<article data-application-id="${escapeHtml(item.id)}" style="border:1px solid #dce8e4;border-radius:16px;padding:13px;margin:9px 0">
        <strong>${escapeHtml(item.brokerName)}</strong>
        <p style="margin:5px 0">فال: ${escapeHtml(item.falLicense)}<br>الجوال: ${escapeHtml(item.phone)}
        <br>البريد: ${escapeHtml(item.email)}<br>المكتب: ${escapeHtml(item.officeName)}</p>
        <input data-office-id="${escapeHtml(item.id)}" value="${suggestOfficeId(item.officeName, item.id)}"
          aria-label="رمز المكتب" style="width:100%;box-sizing:border-box;border:1px solid #d4e3de;border-radius:12px;padding:10px;margin-bottom:8px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="access-btn" data-approve="${escapeHtml(item.id)}">اعتماد</button>
          <button class="access-btn secondary" data-reject="${escapeHtml(item.id)}">رفض</button>
        </div></article>`).join("");
      const requestedApplication = query.get("openBrokerApplication");
      if (requestedApplication) {
        const requestedCard = container.querySelector(`[data-application-id="${CSS.escape(requestedApplication)}"]`);
        if (requestedCard) {
          requestedCard.style.outline = "3px solid rgba(18,140,126,.25)";
          requestedCard.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      container.querySelectorAll("[data-approve],[data-reject]").forEach(button => button.onclick = async () => {
        const id = button.dataset.approve || button.dataset.reject;
        const action = button.dataset.approve ? "approve" : "reject";
        const officeInput = container.querySelector(`[data-office-id="${CSS.escape(id)}"]`);
        button.disabled = true;
        try {
          const freshToken = await firebase.auth().currentUser.getIdToken();
          const actionResponse = await fetch(`${WORKER_BASE}/admin/broker-applications/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${freshToken}` },
            body: JSON.stringify({ applicationId: id, action, officeId: officeInput ? officeInput.value : "" })
          });
          if (!actionResponse.ok) throw new Error("ACTION_FAILED");
          await adminApplications();
        } catch (_) {
          showStatus("تعذر تنفيذ القرار. تحقق من رمز المكتب وحاول مرة أخرى.");
          button.disabled = false;
        }
      });
    } catch (_) {
      showStatus("تعذر تحميل طلبات الوسطاء.");
    }
  }
  async function enableAdminNotifications(sendTest = true) {
    const button = gate.querySelector("#enableAdminNotifications");
    if (!button) return;
    button.disabled = true;
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || typeof firebase.messaging !== "function") throw new Error("NOT_SUPPORTED");
      let permission = Notification.permission;
      if (sendTest && permission !== "granted") permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("PERMISSION_DENIED");
      const configResponse = await fetch(`${WORKER_BASE}/fcm/config`, { cache: "no-store" });
      const config = await configResponse.json();
      if (!config.enabled || !config.vapidKey) throw new Error("FCM_DISABLED");
      const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
      let fcmRegistration = null;
      const fidBridge = window.IAQAR_FCM_READY ? await window.IAQAR_FCM_READY.catch(() => null) : null;
      if (fidBridge && typeof fidBridge.register === "function") {
        const fid = await fidBridge.register({ vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
        if (fid) fcmRegistration = { id: fid, type: "fid" };
      }
      if (!fcmRegistration && typeof firebase.messaging === "function") {
        const token = await firebase.messaging().getToken({ vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
        if (token) fcmRegistration = { id: token, type: "token" };
      }
      if (!fcmRegistration) throw new Error("FCM_REGISTRATION_FAILED");
      const idToken = await firebase.auth().currentUser.getIdToken(true);
      const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` };
      const installationId = (() => {
        const key = "iaqar.notificationInstallationId";
        let value = localStorage.getItem(key);
        if (!value) {
          value = window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          localStorage.setItem(key, value);
        }
        return value;
      })();
      const response = await fetch(`${WORKER_BASE}/fcm/register`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          officeId: "platform",
          fcmRegistrationId: fcmRegistration.id,
          registrationType: fcmRegistration.type,
          fcmToken: fcmRegistration.type === "token" ? fcmRegistration.id : "",
          userAgent: navigator.userAgent,
          deviceName: "إدارة المنصة — " + (navigator.platform || "جهاز"),
          installationId,
          language: navigator.language || "ar-SA",
          notificationPermission: permission,
          appVersion: "stage3-fcm-fid-v1"
        })
      });
      if (!response.ok) throw new Error("REGISTER_FAILED");
      localStorage.setItem("iaqar.fcm.enabled.platform", "1");
      button.textContent = "إشعارات الإدارة مفعّلة";
      if (sendTest) {
        const testResponse = await fetch(`${WORKER_BASE}/fcm/test`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            officeId: "platform",
            fcmRegistrationId: fcmRegistration.id,
            registrationType: fcmRegistration.type,
            fcmToken: fcmRegistration.type === "token" ? fcmRegistration.id : "",
            installationId
          })
        });
        if (!testResponse.ok) throw new Error("TEST_FAILED");
        showStatus("تم التفعيل وإرسال إشعار تجريبي لإدارة المنصة.", true);
      }
    } catch (_) {
      if (sendTest) {
        button.disabled = false;
        showStatus("تعذر تفعيل الإشعارات. تحقق من إعداد FCM وسماح المتصفح.");
      }
    } finally {
      button.disabled = false;
    }
  }
  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char]));
  }
  function suggestOfficeId(name, id) {
    const latin = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return latin || `office-${String(id || "").slice(-8).toLowerCase()}`;
  }

  async function bootstrapAccess() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      frame(`<section class="access-card"><h2>تعذر بدء المنصة</h2><p>تحقق من اتصال الإنترنت ثم حدّث الصفحة.</p></section>`);
      return;
    }
    if (publicSlug && !officeId) {
      try {
        const snapshot = await db().collection("publicOffices").where("publicSlug", "==", publicSlug).limit(1).get();
        if (snapshot.empty) {
          frame(`<section class="access-card"><h2>رابط المكتب غير متاح</h2><p>تحقق من الرابط أو ارجع إلى المنصة العامة.</p><button class="access-btn" id="goPlatformHome">المنصة العامة</button></section>`);
          gate.querySelector("#goPlatformHome").onclick = () => location.assign("/");
          return;
        }
        const data = snapshot.docs[0].data() || {};
        officeId = String(data.officeId || snapshot.docs[0].id || "").trim().toLowerCase();
        refreshRouteFlags();
      } catch (error) {
        console.warn("[iaqar] public slug resolution", error);
        frame(`<section class="access-card"><h2>تعذر فتح رابط المكتب</h2><p>تحقق من الاتصال ثم حاول مرة أخرى.</p></section>`);
        return;
      }
    }
    refreshRouteFlags();
    if (isPublicOfficeLink) publicOffice();
    else if (isPlatformHome) home();
    else firebase.auth().onAuthStateChanged(user => user ? verifyAccess(officeId, false) : loginForm());
  }

  bootstrapAccess();
})();
