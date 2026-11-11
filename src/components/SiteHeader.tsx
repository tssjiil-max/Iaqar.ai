import Link from "next/link";

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="no-print relative z-10 flex items-center justify-between gap-4 px-5 py-4 md:px-8">
      <Link href="/" className="group flex items-baseline gap-3">
        <span
          className="text-2xl font-semibold tracking-tight md:text-3xl"
          style={{ fontFamily: "var(--font-display), serif", color: "var(--bg-mid)" }}
        >
          Iaqar.ai
        </span>
        {!compact && (
          <span className="hidden text-sm text-[var(--muted)] sm:inline">
            مكاتب عقارية ذكية
          </span>
        )}
      </Link>
      <nav className="flex items-center gap-2 text-sm md:gap-3">
        <Link
          href="/inbox"
          className="rounded-md px-3 py-2 text-[var(--ink)] transition hover:bg-[rgba(31,77,58,0.08)]"
        >
          صندوق الرسائل
        </Link>
        <Link
          href="/inbox#compose"
          className="rounded-md bg-[var(--bg-mid)] px-3 py-2 text-[var(--paper)] transition hover:bg-[var(--bg-deep)]"
        >
          تجربة رسالة
        </Link>
      </nav>
    </header>
  );
}
