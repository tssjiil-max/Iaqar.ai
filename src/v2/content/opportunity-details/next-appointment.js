import { escapeContentHtml } from "../domain.js";

function iconUse(id) {
  return `<svg class="cv2-icon" aria-hidden="true"><use href="#${escapeContentHtml(id)}"/></svg>`;
}

export function buildNextAppointmentCardV2(vm = {}) {
  const next = vm.nextAppointment || {};
  const when = String(next.dateTime || "").trim() || "-";
  const type = String(next.type || "").trim() || "-";
  const status = String(next.confirmationStatus || "").trim() || "-";

  return `<section class="cv2-card cv2-appointment" aria-label="الموعد القادم">
    <div class="cv2-appointment-body">
      <div class="cv2-appointment-when">
        <span class="cv2-appointment-icon" aria-hidden="true">${iconUse("i-calendar")}</span>
        <div>
          <span class="cv2-appointment-label">الموعد القادم</span>
          <strong class="cv2-appointment-time">${escapeContentHtml(when)}</strong>
        </div>
      </div>
      <span class="cv2-appointment-divider" aria-hidden="true"></span>
      <div class="cv2-appointment-meta">
        <strong class="cv2-appointment-type">${escapeContentHtml(type)}</strong>
        <span class="cv2-appointment-status">${escapeContentHtml(status)}</span>
      </div>
    </div>
  </section>`;
}
