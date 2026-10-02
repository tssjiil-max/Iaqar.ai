/**
 * «قنوات المكتب» — read-only, secret-free status of the office's message channels.
 * Channels are transport adapters only (Phase 8 boundary): inbound capture, no outbound sending.
 * Nothing here returns tokens, secrets, raw phone numbers or other offices' data.
 */

function text(value) {
  return String(value ?? "").trim();
}

function mask(value) {
  const digits = text(value).replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export const CHANNEL_STATUS = Object.freeze({
  DISCONNECTED: "disconnected",
  SETUP: "setup",
  CONNECTED: "connected"
});

export function buildChannelStatuses({ officeId, whatsappIntegration = null, whatsappUsage = null, env = {} } = {}) {
  const wa = whatsappIntegration && typeof whatsappIntegration === "object" ? whatsappIntegration : {};
  const usage = whatsappUsage && typeof whatsappUsage === "object" ? whatsappUsage : {};
  const waConnected = text(wa.status) === "connected";
  const waSetup = !waConnected && Boolean(text(wa.status));

  const tgSecretSet = Boolean(text(env.TELEGRAM_WEBHOOK_SECRET));
  const tgScope = text(env.TELEGRAM_OFFICE_ID);
  const tgForThisOffice = tgSecretSet && tgScope && tgScope === text(officeId);
  const tgSetup = tgSecretSet && !tgForThisOffice && !tgScope;

  return {
    // Safe default stays "assisted": the system suggests, a human decides. Outbound is never enabled here.
    automationMode: "ASSISTED",
    outboundEnabled: false,
    channels: [
      {
        id: "whatsapp",
        provider: "whatsapp_business_cloud_api",
        status: waConnected ? CHANNEL_STATUS.CONNECTED : waSetup ? CHANNEL_STATUS.SETUP : CHANNEL_STATUS.DISCONNECTED,
        displayPhoneNumber: waConnected ? mask(wa.displayPhoneNumber) : "",
        inboundMessagesToday: Number(usage.inboundMessages || 0),
        inboundOnly: true
      },
      {
        id: "telegram",
        provider: "telegram_bot",
        status: tgForThisOffice ? CHANNEL_STATUS.CONNECTED : tgSetup ? CHANNEL_STATUS.SETUP : CHANNEL_STATUS.DISCONNECTED,
        inboundOnly: true
      }
    ]
  };
}
