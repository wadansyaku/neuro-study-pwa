import test from "node:test";
import assert from "node:assert/strict";
import { applySpacedRepetition } from "../api/_lib/sr.js";

test("applySpacedRepetition updates interval and due date for good", () => {
  const now = Date.now();
  const sr = {intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, dueAt: now, lastGrade: null};
  const next = applySpacedRepetition({sr, grade: "good", now});
  assert.equal(next.reps, 1);
  assert.equal(next.intervalDays, 1);
  assert.equal(next.lastGrade, "good");
  assert.ok(next.dueAt > now);
});

test("applySpacedRepetition resets on again", () => {
  const now = Date.now();
  const sr = {intervalDays: 5, ease: 2.5, reps: 3, lapses: 0, dueAt: now, lastGrade: "good"};
  const next = applySpacedRepetition({sr, grade: "again", now});
  assert.equal(next.reps, 0);
  assert.equal(next.intervalDays, 0);
  assert.equal(next.lapses, 1);
  assert.equal(next.lastGrade, "again");
});
