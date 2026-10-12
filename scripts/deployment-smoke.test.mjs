import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSnapshot } from "./deployment-smoke.mjs";

const entry = "/assets/index-new.js";
const expected = ["Conditioning 1"];
const valid = () => ({
  entry,
  controlled: true,
  unobstructed: true,
  expected,
  actual: [...expected],
});

test("rejects a stale entry asset even when the visible workout order matches", () => {
  assert.throws(
    () => assertSnapshot({ ...valid(), entry: "/assets/index-old.js" }, entry),
    /different frontend build/,
  );
});

test("rejects an uncached session that cannot prove the warm-client update path", () => {
  assert.throws(
    () => assertSnapshot({ ...valid(), controlled: false }, entry),
    /warm-cache verification was not exercised/,
  );
});

test("rejects the whole program instead of the next upcoming workout", () => {
  assert.throws(
    () =>
      assertSnapshot(
        {
          ...valid(),
          actual: [
            "Weights A",
            "Conditioning 1",
            "Weights B",
            "Conditioning 2",
          ],
        },
        entry,
      ),
    /live Training Program schedule/,
  );
});

test("rejects a different workout even when only one card is shown", () => {
  assert.throws(
    () => assertSnapshot({ ...valid(), actual: ["Weights A"] }, entry),
    /live Training Program schedule/,
  );
});

test("accepts the next scheduled workout and unchanged standalone plans", () => {
  const cards = ["Conditioning 1", "Standalone mobility"];
  assertSnapshot({ ...valid(), expected: cards, actual: cards }, entry);
});

test("rejects an empty account instead of reporting a vacuous pass", () => {
  assert.throws(
    () => assertSnapshot({ ...valid(), expected: [], actual: [] }, entry),
    /cannot exercise/,
  );
});

test("rejects a dialog-obstructed surface even when the DOM contains the correct cards", () => {
  assert.throws(
    () => assertSnapshot({ ...valid(), unobstructed: false }, entry),
    /Close open dialogs/,
  );
});
