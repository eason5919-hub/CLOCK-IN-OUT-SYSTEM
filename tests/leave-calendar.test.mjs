import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("leave calendar aligns August 2026 and disables Sundays only", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

  assert.match(script, /grid-column-start: \$\{firstDay \+ 1\}/);
  assert.doesNotMatch(script, /calendar-spacer/);

  const augustFirst = new Date(Date.UTC(2026, 7, 1)).getUTCDay();
  const sundays = Array.from({ length: 31 }, (_, index) => index + 1).filter(
    (day) => new Date(Date.UTC(2026, 7, day)).getUTCDay() === 0,
  );

  assert.equal(augustFirst, 6, "1 August 2026 must start under Saturday");
  assert.deepEqual(sundays, [2, 9, 16, 23, 30], "Only August 2026 Sundays should be disabled for Sunday rule");
});
