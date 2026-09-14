import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
test("missing owner authentication is rejected", async () => {
  const app = await buildApp({
    deviceSecret: "test-secret-is-at-least-32-characters",
    mediaSecret: "test-secret-is-at-least-32-characters",
    engineKey: "test-secret-is-at-least-32-characters",
    cronSecret: "test-secret-is-at-least-32-characters",
  });
  const r = await app.inject({ method: "GET", url: "/me" });
  assert.equal(r.statusCode, 401);
  await app.close();
});
