import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="relative flex flex-1 flex-col">
        <section className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-6xl flex-col justify-center px-5 pb-16 pt-6 md:px-8">
          <div
            className="anim-line mb-6 h-px w-40 bg-[var(--sand-deep)]"
            aria-hidden
          />
          <p
            className="anim-rise text-5xl font-semibold tracking-tight text-[var(--bg-deep)] md:text-7xl"
            style={{ fontFamily: "var(--font-display), serif" }}
          >
            Iaqar.ai
          </p>
          <h1 className="anim-rise-delay mt-4 max-w-2xl text-2xl font-medium leading-snug text-[var(--ink)] md:text-4xl">
            رسائل واتساب تُقرأ، تُدرج، وتُحوَّل للمالك أو العميل أو الوسيط.
          </h1>
          <p className="anim-fade mt-4 max-w-xl text-base leading-8 text-[var(--muted)] md:text-lg">
            إن وُجدت نسخة في نفس الحي يُرسل رد بسيط وتنتهي الرسالة. الوسائط تتعاون
            بين القنوات بحسب محتواها.
          </p>
          <div className="anim-rise-delay mt-8 flex flex-wrap gap-3">
            <Link
              href="/inbox"
              className="rounded-md bg-[var(--bg-mid)] px-5 py-3 text-[var(--paper)] transition hover:bg-[var(--bg-deep)]"
            >
              افتح صندوق الرسائل
            </Link>
            <Link
              href="/inbox#compose"
              className="rounded-md border border-[var(--line)] bg-white/70 px-5 py-3 text-[var(--ink)] transition hover:bg-white"
            >
              جرّب رسالة واردة
            </Link>
          </div>

          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[55%] overflow-hidden"
            aria-hidden
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, transparent 0%, rgba(22,53,40,0.08) 40%, rgba(22,53,40,0.22) 100%), url('/media/sample-listing.svg') center/cover no-repeat",
              }}
            />
          </div>
        </section>
      </main>
    </>
  );
}
