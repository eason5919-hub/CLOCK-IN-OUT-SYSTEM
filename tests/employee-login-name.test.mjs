import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("employee login accepts compacted name matches", async () => {
  const [registerRoute, loginRoute] = await Promise.all([
    readFile(new URL("../app/api/auth/employee-register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/employee-login/route.ts", import.meta.url), "utf8"),
  ]);

  for (const route of [registerRoute, loginRoute]) {
    assert.match(route, /function namesMatch/);
    assert.match(route, /function compactName/);
    assert.match(route, /replace\(\/\[\^A-Z0-9\]\/g, ""\)/);
    assert.match(route, /compactStoredName === compactName\(inputName\)/);
  }
});
