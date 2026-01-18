import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSession, normalizeUserId } from "../sessionStore.js";

test("normalizeUserId accepts allowed IDs", () => {
  assert.equal(normalizeUserId("user_01"), "user_01");
  assert.equal(normalizeUserId(""), "");
});

test("normalizeUserId rejects invalid IDs", () => {
  assert.equal(normalizeUserId("invalid id"), null);
  assert.equal(normalizeUserId("あいう"), null);
});

test("normalizeSession rejects invalid userId", () => {
  const result = normalizeSession({userId: "bad id", apiToken: "token"});
  assert.equal(result, null);
});

test("normalizeSession trims fields", () => {
  const result = normalizeSession({userId: "user_02 ", apiToken: " token ", apiBase: " https://api.example "});
  assert.deepEqual(result, {
    apiBase: "https://api.example",
    apiToken: "token",
    userId: "user_02"
  });
});
