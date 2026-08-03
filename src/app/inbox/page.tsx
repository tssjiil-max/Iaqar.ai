import { SiteHeader } from "@/components/SiteHeader";
import { InboxApp } from "@/components/InboxApp";

export default function InboxPage() {
  return (
    <>
      <SiteHeader compact />
      <main className="flex flex-1 flex-col pt-2">
        <InboxApp />
      </main>
    </>
  );
}
