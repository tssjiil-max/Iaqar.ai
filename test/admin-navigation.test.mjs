import test from "node:test";
import assert from "node:assert/strict";
import {
  createAdminFrame,
  currentAdminFrame,
  popAdminFrame,
  pushAdminFrame,
  resolveAdminBackAction,
  shouldShowAdminBack
} from "../public/js/admin-navigation-domain.js";

test("admin back navigation closes detail before leaving list view", () => {
  let stack = [createAdminFrame("offices")];
  stack = pushAdminFrame(stack, createAdminFrame("office-detail", { officeId: "office-a" }));
  assert.equal(shouldShowAdminBack(stack), true);
  assert.deepEqual(resolveAdminBackAction(stack), { type: "pop-frame" });
  const popped = popAdminFrame(stack);
  assert.equal(currentAdminFrame(popped.stack).view, "offices");
  assert.equal(shouldShowAdminBack(popped.stack), false);
});

test("admin root view does not show back button", () => {
  const stack = [createAdminFrame("overview")];
  assert.equal(resolveAdminBackAction(stack), null);
  assert.equal(shouldShowAdminBack(stack), false);
});

test("admin navigation stack preserves office detail context", () => {
  const stack = pushAdminFrame(
    [createAdminFrame("offices")],
    createAdminFrame("office-detail", { officeId: "office-b" })
  );
  assert.equal(currentAdminFrame(stack).officeId, "office-b");
});
