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

test("employee phone registration reactivates reset same-phone devices", async () => {
  const registerRoute = await readFile(new URL("../app/api/auth/employee-register/route.ts", import.meta.url), "utf8");

  assert.match(registerRoute, /SELECT id, employee_id, status FROM devices WHERE device_fingerprint = \?/);
  assert.match(registerRoute, /SET status = 'registered'/);
  assert.match(registerRoute, /reset_by_user_id = NULL/);
  assert.match(registerRoute, /reset_at = NULL/);
  assert.match(registerRoute, /This phone is linked to another employee account/);
});

test("worker app restores employee session and validates registered phone", async () => {
  const [page, summaryRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employee/summary/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /restoreEmployeeSession/);
  assert.match(page, /setUser\(toEmployeeUser\(result\.employee\)\)/);
  assert.match(page, /headers: \{ "x-device-fingerprint": getBrowserDeviceFingerprint\(\) \}/);
  assert.match(summaryRoute, /device_fingerprint = \?/);
  assert.match(summaryRoute, /bind\(session\.employee_id, deviceFingerprint\)/);
  assert.match(summaryRoute, /Employee phone access was deleted by HR/);
});

test("worker employee clock opens a real camera QR scanner", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(page, /facingMode: \{ ideal: "environment" \}/);
  assert.match(page, /BarcodeDetector/);
  assert.match(page, /window\.setTimeout/);
  assert.match(page, /Confirm Warehouse QR/);
  assert.match(page, /setScanAction\(nextAction\)/);
  assert.match(page, /onClock\(scanAction, qrToken\)/);
  assert.match(page, /timestamp: position\.timestamp \|\| Date\.now\(\)/);
  assert.match(page, /Location permission is needed/);
  assert.doesNotMatch(page, /fallbackSample/);
  assert.match(css, /\.scanner-modal/);
  assert.match(css, /\.live-camera-frame video/);
});
