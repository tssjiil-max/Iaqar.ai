import { SiteHeader } from "@/components/SiteHeader";
import { InboxApp } from "@/components/InboxApp";
import { listMessages } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  const initialMessages = listMessages();

  return (
    <>
      <SiteHeader compact />
      <main className="flex flex-1 flex-col pt-2">
        <InboxApp initialMessages={initialMessages} />
      </main>
    </>
  );
}
