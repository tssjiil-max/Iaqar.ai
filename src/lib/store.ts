import { processIncomingMessage } from "./process-message";
import { seedMessages } from "./seed";
import type { IncomingMessage, ProcessResult } from "./types";

type StoreShape = {
  messages: IncomingMessage[];
};

const globalForStore = globalThis as typeof globalThis & {
  __iaqarStore?: StoreShape;
};

function getStore(): StoreShape {
  if (!globalForStore.__iaqarStore) {
    globalForStore.__iaqarStore = {
      messages: structuredClone(seedMessages),
    };
  }
  return globalForStore.__iaqarStore;
}

export function listMessages(): IncomingMessage[] {
  return [...getStore().messages].sort(
    (a, b) =>
      new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );
}

export function getMessage(id: string): IncomingMessage | undefined {
  return getStore().messages.find((message) => message.id === id);
}

export function ingestMessage(
  input: Omit<IncomingMessage, "id" | "status" | "copyCount"> & {
    id?: string;
    status?: IncomingMessage["status"];
    copyCount?: number;
  },
): ProcessResult {
  const store = getStore();
  const draft: IncomingMessage = {
    ...input,
    id: input.id ?? `msg-${Date.now()}`,
    status: input.status ?? "new",
    copyCount: input.copyCount ?? 0,
  };

  const result = processIncomingMessage(draft, store.messages);
  store.messages = [result.message, ...store.messages];
  return result;
}

export function markPrinted(id: string): IncomingMessage | undefined {
  const store = getStore();
  const index = store.messages.findIndex((message) => message.id === id);
  if (index < 0) return undefined;

  const updated: IncomingMessage = {
    ...store.messages[index],
    printedAt: new Date().toISOString(),
    status:
      store.messages[index].status === "duplicate_closed"
        ? "duplicate_closed"
        : "printed",
  };
  store.messages[index] = updated;
  return updated;
}

export function bumpCopy(id: string): IncomingMessage | undefined {
  const store = getStore();
  const index = store.messages.findIndex((message) => message.id === id);
  if (index < 0) return undefined;

  const updated: IncomingMessage = {
    ...store.messages[index],
    copyCount: store.messages[index].copyCount + 1,
  };
  store.messages[index] = updated;
  return updated;
}

export function resetStore(): IncomingMessage[] {
  globalForStore.__iaqarStore = {
    messages: structuredClone(seedMessages),
  };
  return listMessages();
}
