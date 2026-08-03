import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("leave calendar aligns August 2026 and disables Sundays only", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

  assert.match(script, /calendar-empty/);
  assert.doesNotMatch(script, /grid-column-start/);

  const augustFirst = new Date(Date.UTC(2026, 7, 1)).getUTCDay();
  const sundays = Array.from({ length: 31 }, (_, index) => index + 1).filter(
    (day) => new Date(Date.UTC(2026, 7, day)).getUTCDay() === 0,
  );
  const augustCells = [
    ...Array.from({ length: augustFirst }, () => null),
    ...Array.from({ length: 31 }, (_, index) => index + 1),
  ];

  assert.equal(augustFirst, 6, "1 August 2026 must start under Saturday");
  assert.deepEqual(augustCells.slice(0, 7), [null, null, null, null, null, null, 1], "First row must keep Sunday left and Saturday right");
  assert.deepEqual(augustCells.slice(7, 14), [2, 3, 4, 5, 6, 7, 8], "Second row must start with Sunday date 2");
  assert.deepEqual(sundays, [2, 9, 16, 23, 30], "Only August 2026 Sundays should be disabled for Sunday rule");
});
