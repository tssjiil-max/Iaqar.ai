import test from "node:test";
import assert from "node:assert/strict";

class TestCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail;
  }
}

test("operations center bridge replays cached operations before open-operation is handled", async () => {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  const windowTarget = new EventTarget();
  const cachedItems = [
    {
      id: "operation-match-review-1",
      recordType: "operation",
      operationType: "MATCH_REVIEW",
      matchId: "match-1"
    }
  ];
  windowTarget.IAQAR = { operationsItems: cachedItems };

  globalThis.window = windowTarget;
  globalThis.CustomEvent = TestCustomEvent;

  try {
    await import(`../public/js/operations-center-bridge.js?cached-open=${Date.now()}`);

    const received = [];
    windowTarget.addEventListener("iaqar:operations-data", (event) => {
      received.push(event.detail);
    });

    windowTarget.dispatchEvent(new TestCustomEvent("iaqar:open-operation", {
      detail: { id: "operation-match-review-1", matchId: "match-1" }
    }));

    assert.equal(received.length, 1, "cached operations should be replayed synchronously before the open request continues");
    assert.equal(received[0].authoritative, true);
    assert.deepEqual(received[0].items, cachedItems);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  }
});
