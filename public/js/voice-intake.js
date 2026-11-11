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

  function applyVoiceFields(form, parsed, options = {}) {
    const propertySelect = form.querySelector('[name="propertyType"], #propertyTypeSelect, #intakePropertyType');
    const districtSelect = form.querySelector('[name="district"], #districtSelect, #intakeDistrict');
    const detailsField = form.querySelector('[name="details"], #intakeDetails');
    const unmatched = [];

    if (parsed.propertyType && propertySelect) {
      const applied = setSelectValue(propertySelect, parsed.propertyType);
      if (!applied) unmatched.push("propertyType");
    } else if (parsed.unmatched && parsed.unmatched.includes("propertyType")) {
      unmatched.push("propertyType");
    }

    if (parsed.district && districtSelect) {
      const applied = setSelectValue(districtSelect, parsed.district);
      if (!applied) {
        const otherWrap = form.querySelector("#otherDistrictWrap");
        if (districtSelect.querySelector('option[value="__other__"]')) {
          districtSelect.value = "__other__";
          districtSelect.dispatchEvent(new Event("change", { bubbles: true }));
          const otherInput = form.querySelector('[name="otherDistrict"]');
          if (otherInput) otherInput.value = parsed.district;
        } else {
          unmatched.push("district");
        }
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
        const unmatched = applyVoiceFields(form, parsed, options);
        if (unmatched.length) status.textContent = "لم يتم التعرف على بعض الخيارات";
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
