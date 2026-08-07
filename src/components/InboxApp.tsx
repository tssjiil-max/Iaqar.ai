"use client";

import {
  useMemo,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  channelLabels,
  intentLabels,
  mediaLabels,
  roleLabels,
  statusLabels,
} from "@/lib/labels";
import type {
  IncomingMessage,
  ListingIntent,
  MediaKind,
  MessageChannel,
  PartyRole,
  ProcessResult,
} from "@/lib/types";

const roleFilters: Array<PartyRole | "all"> = [
  "all",
  "owner",
  "customer",
  "agent",
];

export function InboxApp({
  initialMessages,
}: {
  initialMessages: IncomingMessage[];
}) {
  const [messages, setMessages] = useState<IncomingMessage[]>(initialMessages);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialMessages[0]?.id ?? null,
  );
  const [filter, setFilter] = useState<PartyRole | "all">("all");
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    fromRole: "customer" as PartyRole,
    fromName: "",
    channel: "whatsapp" as MessageChannel,
    mediaKind: "text" as MediaKind,
    neighborhood: "النرجس",
    city: "الرياض",
    intent: "sale" as ListingIntent,
    propertyType: "شقة",
    text: "هل عندكم شقق للبيع في النرجس ٤ غرف؟",
  });

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/messages", { cache: "no-store" });
      const data = (await res.json()) as { messages: IncomingMessage[] };
      setMessages(data.messages);
      setSelectedId((current) => {
        if (current && data.messages.some((message) => message.id === current)) {
          return current;
        }
        return data.messages[0]?.id ?? null;
      });
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (filter === "all") return messages;
    return messages.filter((message) => message.from.role === filter);
  }, [filter, messages]);

  const selected =
    filtered.find((message) => message.id === selectedId) ??
    filtered[0] ??
    null;

  function showFlash(text: string) {
    setFlash(text);
    window.setTimeout(() => setFlash(null), 3200);
  }

  async function onCopy(message: IncomingMessage) {
    const res = await fetch(`/api/messages/${message.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "copy" }),
    });
    const data = (await res.json()) as {
      clipboard?: string;
      message?: IncomingMessage;
    };
    if (data.clipboard) {
      await navigator.clipboard.writeText(data.clipboard);
      showFlash("تم نسخ الرسالة إلى الحافظة.");
    }
    await refresh();
  }

  async function onPrint(message: IncomingMessage) {
    await fetch(`/api/messages/${message.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "print" }),
    });
    await refresh();
    showFlash("تم تجهيز النسخة للطباعة.");
    window.print();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromRole: form.fromRole,
          fromName: form.fromName || undefined,
          channel: form.channel,
          mediaKind: form.mediaKind,
          text: form.text,
          listing: {
            neighborhood: form.neighborhood,
            city: form.city,
            intent: form.intent,
            propertyType: form.propertyType,
          },
        }),
      });
      const result = (await res.json()) as ProcessResult;
      await refresh();
      setSelectedId(result.message.id);
      showFlash(result.summary);
    });
  }

  async function onReset() {
    startTransition(async () => {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      setSelectedId(null);
      await refresh();
      showFlash("تمت إعادة تعيين الرسائل التجريبية.");
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 pb-10 md:px-8">
      <div className="anim-rise no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--bg-deep)] md:text-3xl">
            صندوق رسائل واتساب
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)] md:text-base">
            الموقع يقرأ الرسائل، يدرجها، يطبعها، ويصنع نسخة منها. إن وُجدت نسخة في
            نفس الحي يُرسل رد بسيط وتنتهي الرسالة. التحويل للمالك أو العميل أو
            الوسيط حسب المصدر ونوع الوسائط.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onReset()}
          className="rounded-md border border-[var(--line)] bg-white/70 px-3 py-2 text-sm text-[var(--muted)] transition hover:bg-white"
        >
          إعادة التعيين
        </button>
      </div>

      {flash && (
        <div className="anim-fade no-print rounded-md border border-[rgba(31,77,58,0.2)] bg-[rgba(31,77,58,0.08)] px-4 py-3 text-sm text-[var(--bg-deep)]">
          {flash}
        </div>
      )}

      <div className="no-print flex flex-wrap gap-2">
        {roleFilters.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => setFilter(role)}
            className="rounded-md px-3 py-1.5 text-sm transition"
            style={{
              background:
                filter === role ? "var(--bg-mid)" : "rgba(255,255,255,0.65)",
              color: filter === role ? "var(--paper)" : "var(--ink)",
              border: "1px solid var(--line)",
            }}
          >
            {role === "all" ? "الكل" : roleLabels[role]}
          </button>
        ))}
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
        <section className="anim-rise no-print overflow-hidden rounded-xl border border-[var(--line)] bg-white/75 shadow-[0_10px_40px_rgba(20,35,28,0.06)]">
          <div className="border-b border-[var(--line)] px-4 py-3 text-sm text-[var(--muted)]">
            {loading ? "جارٍ التحميل…" : `${filtered.length} رسالة`}
          </div>
          <ul className="max-h-[640px] divide-y divide-[var(--line)] overflow-auto">
            {filtered.map((message) => {
              const active = selected?.id === message.id;
              return (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(message.id)}
                    className="flex w-full flex-col gap-2 px-4 py-3 text-right transition"
                    style={{
                      background: active
                        ? "rgba(31,77,58,0.08)"
                        : "transparent",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{message.from.name}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {new Date(message.receivedAt).toLocaleString("ar-SA")}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm text-[var(--muted)]">
                      {message.body}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Tag>{channelLabels[message.channel]}</Tag>
                      <Tag>{roleLabels[message.from.role]}</Tag>
                      <Tag tone={statusTone(message.status)}>
                        {statusLabels[message.status]}
                      </Tag>
                      {message.listing && (
                        <Tag>{message.listing.neighborhood}</Tag>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
            {!loading && filtered.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                لا رسائل في هذا التصفية.
              </li>
            )}
          </ul>
        </section>

        <section className="anim-rise-delay flex flex-col gap-4">
          {selected ? (
            <article className="rounded-xl border border-[var(--line)] bg-white/80 p-5 shadow-[0_10px_40px_rgba(20,35,28,0.06)]">
              <div className="no-print mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-[var(--bg-deep)]">
                    {selected.from.name}
                  </h2>
                  <p className="text-sm text-[var(--muted)]">
                    {roleLabels[selected.from.role]} · {selected.from.phone}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ActionButton onClick={() => void onCopy(selected)}>
                    نسخ
                  </ActionButton>
                  <ActionButton onClick={() => void onPrint(selected)}>
                    طباعة
                  </ActionButton>
                </div>
              </div>

              <div className="print-only mb-4">
                <h2 className="text-xl font-semibold">Iaqar.ai — نسخة مطبوعة</h2>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                <Meta label="القناة" value={channelLabels[selected.channel]} />
                <Meta label="الوسائط" value={mediaLabels[selected.mediaKind]} />
                <Meta label="الحالة" value={statusLabels[selected.status]} />
                <Meta
                  label="التحويل"
                  value={
                    selected.routedTo
                      ? roleLabels[selected.routedTo]
                      : "لم يُحوَّل بعد"
                  }
                />
                <Meta
                  label="عدد النسخ"
                  value={String(selected.copyCount)}
                />
                <Meta
                  label="الحي"
                  value={selected.listing?.neighborhood ?? "—"}
                />
              </dl>

              <div className="mt-5 min-h-28 whitespace-pre-wrap rounded-lg bg-[rgba(243,239,230,0.7)] p-4 text-[15px] leading-7">
                {selected.body}
              </div>

              {selected.mediaUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.mediaUrl}
                  alt="وسائط مرفقة"
                  className="mt-4 max-h-56 w-full rounded-lg object-cover"
                />
              )}

              {selected.listing && (
                <p className="mt-4 text-sm text-[var(--muted)]">
                  إشارة عقار: {intentLabels[selected.listing.intent]} ·{" "}
                  {selected.listing.propertyType ?? "عقار"} ·{" "}
                  {selected.listing.neighborhood}، {selected.listing.city}
                  {selected.listing.priceHint
                    ? ` · ${selected.listing.priceHint}`
                    : ""}
                </p>
              )}

              {selected.autoReply && (
                <div className="mt-4 rounded-lg border border-[rgba(154,107,47,0.35)] bg-[rgba(154,107,47,0.08)] p-3 text-sm">
                  <strong className="text-[var(--warn)]">رد بسيط تلقائي:</strong>
                  <p className="mt-1">{selected.autoReply}</p>
                  {selected.duplicateOfId && (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      نسخة من الرسالة {selected.duplicateOfId} في نفس الحي —
                      انتهت المعالجة.
                    </p>
                  )}
                </div>
              )}

              {selected.notes && (
                <p className="mt-4 text-sm text-[var(--bg-mid)]">{selected.notes}</p>
              )}
            </article>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--line)] bg-white/50 p-8 text-center text-[var(--muted)]">
              اختر رسالة لعرض التفاصيل.
            </div>
          )}

          <form
            id="compose"
            onSubmit={onSubmit}
            className="no-print rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.72)] p-5"
          >
            <h3 className="text-lg font-semibold text-[var(--bg-deep)]">
              أرسل رسالة تجريبية
            </h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              جرّب نفس الحي لاكتشاف النسخة، أو غيّر نوع الوسائط لرؤية تعاون القنوات.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="المرسل">
                <select
                  value={form.fromRole}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      fromRole: e.target.value as PartyRole,
                    }))
                  }
                  className="field"
                >
                  <option value="owner">المالك</option>
                  <option value="customer">العميل</option>
                  <option value="agent">الوسيط</option>
                </select>
              </Field>
              <Field label="الاسم (اختياري)">
                <input
                  className="field"
                  value={form.fromName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fromName: e.target.value }))
                  }
                  placeholder="مثال: أحمد"
                />
              </Field>
              <Field label="القناة">
                <select
                  className="field"
                  value={form.channel}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      channel: e.target.value as MessageChannel,
                    }))
                  }
                >
                  <option value="whatsapp">واتساب</option>
                  <option value="website">الموقع</option>
                  <option value="instagram">إنستغرام</option>
                  <option value="sms">رسالة نصية</option>
                </select>
              </Field>
              <Field label="نوع الوسائط">
                <select
                  className="field"
                  value={form.mediaKind}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      mediaKind: e.target.value as MediaKind,
                    }))
                  }
                >
                  <option value="text">نص</option>
                  <option value="image">صورة</option>
                  <option value="audio">صوت</option>
                  <option value="document">مستند</option>
                  <option value="location">موقع</option>
                </select>
              </Field>
              <Field label="الحي">
                <input
                  className="field"
                  value={form.neighborhood}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, neighborhood: e.target.value }))
                  }
                />
              </Field>
              <Field label="نوع العقار">
                <input
                  className="field"
                  value={form.propertyType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, propertyType: e.target.value }))
                  }
                />
              </Field>
              <Field label="الغرض">
                <select
                  className="field"
                  value={form.intent}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      intent: e.target.value as ListingIntent,
                    }))
                  }
                >
                  <option value="sale">بيع</option>
                  <option value="rent">إيجار</option>
                  <option value="buy">شراء</option>
                  <option value="inquiry">استفسار</option>
                </select>
              </Field>
              <Field label="المدينة">
                <input
                  className="field"
                  value={form.city}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, city: e.target.value }))
                  }
                />
              </Field>
            </div>

            <Field label="نص الرسالة">
              <textarea
                className="field mt-3 min-h-24"
                value={form.text}
                onChange={(e) =>
                  setForm((f) => ({ ...f, text: e.target.value }))
                }
              />
            </Field>

            <button
              type="submit"
              disabled={pending}
              className="mt-4 rounded-md bg-[var(--bg-mid)] px-4 py-2.5 text-sm text-[var(--paper)] transition hover:bg-[var(--bg-deep)] disabled:opacity-60"
            >
              {pending ? "جارٍ المعالجة…" : "معالجة الرسالة"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger";
}) {
  const colors = {
    neutral: "bg-[rgba(20,35,28,0.06)] text-[var(--ink)]",
    ok: "bg-[rgba(47,107,79,0.12)] text-[var(--ok)]",
    warn: "bg-[rgba(154,107,47,0.12)] text-[var(--warn)]",
    danger: "bg-[rgba(138,59,50,0.12)] text-[var(--danger)]",
  };
  return (
    <span className={`rounded px-2 py-0.5 ${colors[tone]}`}>{children}</span>
  );
}

function statusTone(
  status: IncomingMessage["status"],
): "neutral" | "ok" | "warn" | "danger" {
  if (status === "duplicate_closed") return "warn";
  if (status === "routed" || status === "printed") return "ok";
  if (status === "new") return "danger";
  return "neutral";
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

function ActionButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-sm transition hover:bg-[rgba(31,77,58,0.06)]"
    >
      {children}
    </button>
  );
}
