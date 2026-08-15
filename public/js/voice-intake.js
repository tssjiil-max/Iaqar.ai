(() => {
  "use strict";

  const lifecycle = () => window.IAQAR_LIFECYCLE;

  function speechSupported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function createRecognizer() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;
    const recognizer = new SpeechRecognition();
    recognizer.lang = "ar-SA";
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;
    return recognizer;
  }

  function setSelectValue(select, value) {
    if (!select || !value) return false;
    const option = Array.from(select.options).find(entry => entry.value === value);
    if (!option) return false;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setFieldValue(field, value, { markReview = false } = {}) {
    if (!field || !value) return false;
    if (field.tagName === "SELECT") return setSelectValue(field, value);
    field.value = String(value);
    if (markReview) field.classList.add("voice-needs-review");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function extractSpokenDistrict(transcript = "") {
    const match = String(transcript || "").match(/حي\s+[^\s،,.]+(?:\s+[^\s،,.]+)?/);
    return match ? match[0].trim() : "";
  }

  function extractSpokenPropertyType(transcript = "") {
    const text = String(transcript || "");
    const patterns = [
      /مكتب\s+للبيع/,
      /مكتب/,
      /عمارة/,
      /شقة/,
      /فيلا/,
      /دور/,
      /أرض\s+سكنية/,
      /أرض\s+تجارية/,
      /أرض/,
      /ارض/,
      /محل/,
      /استراحة/,
      /مزرعة/
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) return m[0].trim();
    }
    return "";
  }

  function applyVoiceFields(form, parsed, options = {}) {
    const transcript = options.transcript || "";
    const propertyField = form.querySelector(
      '[name="propertyType"], #propertyTypeInput, #propertyTypeSelect, #intakePropertyType'
    );
    const districtField = form.querySelector(
      '[name="district"], #districtInput, #districtSelect, #intakeDistrict'
    );
    const detailsField = form.querySelector('[name="details"], #intakeDetails');
    const unmatched = [];

    if (parsed.propertyType && propertyField) {
      const applied = setFieldValue(propertyField, parsed.propertyType);
      if (!applied) unmatched.push("propertyType");
    } else if (propertyField && transcript) {
      const spoken = extractSpokenPropertyType(transcript);
      if (spoken) {
        setFieldValue(propertyField, spoken, { markReview: true });
      } else if (parsed.unmatched && parsed.unmatched.includes("propertyType")) {
        unmatched.push("propertyType");
      }
    } else if (parsed.unmatched && parsed.unmatched.includes("propertyType")) {
      unmatched.push("propertyType");
    }

    if (parsed.district && districtField) {
      const applied = setFieldValue(districtField, parsed.district);
      if (!applied && districtField.tagName === "SELECT") {
        const otherWrap = form.querySelector("#otherDistrictWrap");
        if (districtField.querySelector('option[value="__other__"]')) {
          districtField.value = "__other__";
          districtField.dispatchEvent(new Event("change", { bubbles: true }));
          const otherInput = form.querySelector('[name="otherDistrict"]');
          if (otherInput) otherInput.value = parsed.district;
        } else {
          unmatched.push("district");
        }
      }
    } else if (districtField && transcript) {
      const spoken = extractSpokenDistrict(transcript);
      if (spoken) {
        setFieldValue(districtField, spoken, { markReview: true });
      } else if (parsed.unmatched && parsed.unmatched.includes("district")) {
        unmatched.push("district");
      }
    }

    if (parsed.area && detailsField) {
      const prefix = detailsField.value ? `${detailsField.value.trim()} ` : "";
      if (!/مساح/.test(detailsField.value || "")) {
        detailsField.value = `${prefix}مساحة ${parsed.area} م²`.trim();
      }
    }

    if (parsed.transactionType && detailsField) {
      const label = parsed.transactionType === "rent" ? "إيجار" : "شراء";
      if (!new RegExp(label).test(detailsField.value || "")) {
        detailsField.value = `${detailsField.value || ""} ${label}`.trim();
      }
    }

    return unmatched;
  }

  function attachVoiceIntake(form, options = {}) {
    if (!form || form.dataset.voiceBound === "1") return;
    form.dataset.voiceBound = "1";

    const button = document.createElement("button");
    button.type = "button";
    button.className = options.buttonClass || "access-btn light";
    button.textContent = options.buttonLabel || "تعبئة بالصوت";
    button.style.marginTop = "8px";

    const status = document.createElement("p");
    status.className = options.statusClass || "file-help";
    status.setAttribute("aria-live", "polite");

    const host = form.querySelector(options.hostSelector || ".full:last-of-type") || form;
    host.insertAdjacentElement("beforebegin", button);
    button.insertAdjacentElement("afterend", status);

    let listening = false;
    let recognizer = null;

    button.addEventListener("click", () => {
      if (!speechSupported()) {
        status.textContent = "التعرف الصوتي غير متاح في هذا المتصفح.";
        return;
      }
      if (listening && recognizer) {
        recognizer.stop();
        return;
      }
      recognizer = createRecognizer();
      if (!recognizer) return;
      listening = true;
      button.textContent = "إيقاف الاستماع";
      status.textContent = "استمع…";
      recognizer.onresult = event => {
        const transcript = event.results[0] && event.results[0][0] ? event.results[0][0].transcript : "";
        if (!transcript) return;
        const parsed = lifecycle().parseVoiceOpportunityFields(transcript, {
          propertyTypes: options.propertyTypes || [],
          districts: options.districts || []
        });
        const unmatched = applyVoiceFields(form, parsed, { ...options, transcript });
        if (unmatched.length) status.textContent = "تم تعبئة النص المسموع — راجع الحقول المعلّمة";
        else status.textContent = "تم تعبئة الحقول من الصوت";
      };
      recognizer.onerror = () => {
        status.textContent = "تعذر التعرف على الصوت";
        listening = false;
        button.textContent = options.buttonLabel || "تعبئة بالصوت";
      };
      recognizer.onend = () => {
        listening = false;
        button.textContent = options.buttonLabel || "تعبئة بالصوت";
      };
      recognizer.start();
    });
  }

  window.IAQAR_VOICE_INTAKE = { attachVoiceIntake, applyVoiceFields, speechSupported };
})();
