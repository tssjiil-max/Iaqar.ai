import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const login = fs.readFileSync(new URL("../public/os/views/login.js", import.meta.url), "utf8");

test("login screen gives a new broker a way to apply", () => {
  assert.match(login, /data-broker-signup/, "a new broker must find the registration entry on the login screen");
  assert.match(login, /تسجيل وسيط جديد/);
  assert.match(login, /renderBrokerApplication/, "the entry opens the application form inside Office OS");
  assert.doesNotMatch(login, /legacy\.html/);
});
