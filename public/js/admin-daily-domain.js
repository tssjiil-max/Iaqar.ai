/**
 * Platform-admin daily tasks — pure logic, no I/O.
 * Builds the next required admin actions from real office/application rows.
 * Never invents match cards or broker send actions.
 */

function text(value) {
  return String(value == null ? "" : value).trim();
}

function applicationId(row) {
  return text(row.applicationId || row.id);
}

function officeId(row) {
  return text(row.officeId || row.id);
}

export function buildAdminDailyTasks({ offices = [], applications = [] } = {}) {
  const tasks = [];
  const seen = new Set();

  for (const row of applications) {
    if (text(row.status).toLowerCase() !== "pending") continue;
    const id = applicationId(row);
    if (!id || seen.has(`application:${id}`)) continue;
    seen.add(`application:${id}`);
    const officeName = text(row.officeName) || "طلب مكتب جديد";
    tasks.push({
      id: `application:${id}`,
      kind: "application",
      urgency: "الآن",
      title: `اعتماد مكتب — ${officeName}`,
      body: "طلب تسجيل وسيط بانتظار التحقق من رخصة فال واعتماد المنصة.",
      applicationId: id,
      officeName,
      brokerName: text(row.brokerName),
      phone: text(row.phone),
      licenseNumber: text(row.licenseNumber || row.falLicense)
    });
  }

  for (const row of offices) {
    const id = officeId(row);
    if (!id || id === "platform") continue;
    const name = text(row.officeName) || id;
    const account = text(row.accountStatus).toLowerCase();
    const subscription = text(row.subscriptionStatus).toLowerCase();
    const license = text(row.licenseStatus).toLowerCase();

    if (account === "suspended" && !seen.has(`suspended:${id}`)) {
      seen.add(`suspended:${id}`);
      tasks.push({
        id: `suspended:${id}`,
        kind: "suspended",
        urgency: "موقوف",
        title: `مكتب موقوف — ${name}`,
        body: "الحساب موقف ويحتاج مراجعة لإعادة التفعيل أو الإبقاء على الإيقاف.",
        officeId: id,
        officeName: name
      });
    }

    if ((subscription === "expired" || license === "expired") && !seen.has(`expired:${id}`)) {
      seen.add(`expired:${id}`);
      const parts = [];
      if (subscription === "expired") parts.push("الاشتراك");
      if (license === "expired") parts.push("الترخيص");
      tasks.push({
        id: `expired:${id}`,
        kind: "expired",
        urgency: "منتهٍ",
        title: `تجديد مطلوب — ${name}`,
        body: `انتهى ${parts.join(" و")}. راجع حالة المكتب قبل استئناف التشغيل.`,
        officeId: id,
        officeName: name
      });
    } else if ((subscription === "expiring" || license === "expiring") && !seen.has(`expiring:${id}`)) {
      seen.add(`expiring:${id}`);
      tasks.push({
        id: `expiring:${id}`,
        kind: "expiring",
        urgency: "قريب",
        title: `ينتهي قريبًا — ${name}`,
        body: "اشتراك أو ترخيص يقترب من الانتهاء.",
        officeId: id,
        officeName: name
      });
    }
  }

  return tasks;
}
