/** «قنوات المكتب» — presentation of the Worker's secret-free channel status. */

export const CHANNEL_LABELS = Object.freeze({
  whatsapp: { name: "واتساب للأعمال", icon: "whatsapp", hint: "استقبال رسائل العملاء ومالكي العقارات داخل مكتبك" },
  telegram: { name: "تيليجرام", icon: "telegram", hint: "استقبال الرسائل عبر بوت المكتب" }
});

export const CHANNEL_STATUS_LABELS = Object.freeze({
  connected: "متصل",
  setup: "جاري الإعداد",
  disconnected: "غير متصل"
});

export const AUTOMATION_LABELS = Object.freeze({
  ASSISTED: "مساعد — النظام يقترح وأنت تقرر",
  BOT_PARTIES: "بوت المكتب يتواصل مع الأطراف المرتبطين به — وأنت تتدخل عند الحاجة"
});

export function channelViews(payload) {
  const list = Array.isArray(payload?.channels) ? payload.channels : [];
  return list
    .filter((channel) => CHANNEL_LABELS[channel?.id])
    .map((channel) => {
      const meta = CHANNEL_LABELS[channel.id];
      const status = CHANNEL_STATUS_LABELS[channel.status] ? channel.status : "disconnected";
      const detail = [];
      if (status === "connected" && channel.displayPhoneNumber) detail.push(channel.displayPhoneNumber);
      if (status === "connected" && channel.id === "whatsapp") detail.push(`رسائل اليوم: ${Number(channel.inboundMessagesToday || 0)}`);
      return { id: channel.id, name: meta.name, icon: meta.icon, hint: meta.hint, status, statusLabel: CHANNEL_STATUS_LABELS[status], detail: detail.join(" · ") };
    });
}

export function automationLabel(payload) {
  return AUTOMATION_LABELS[payload?.automationMode] || AUTOMATION_LABELS.ASSISTED;
}
