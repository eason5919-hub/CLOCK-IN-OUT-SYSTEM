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
  const [registerRoute, runtime] = await Promise.all([
    readFile(new URL("../app/api/auth/employee-register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/runtime.ts", import.meta.url), "utf8"),
  ]);

  assert.match(registerRoute, /restoreEmployeeDevice/);
  assert.match(runtime, /export async function restoreEmployeeDevice/);
  assert.match(runtime, /SELECT id, employee_id, status FROM devices WHERE device_fingerprint = \?/);
  assert.match(runtime, /SET status = 'registered'/);
  assert.match(runtime, /reset_by_user_id = NULL/);
  assert.match(runtime, /reset_at = NULL/);
  assert.match(runtime, /previousEmployee\?\.status !== "deleted"/);
  assert.match(runtime, /previousEmployeeCanTransfer/);
  assert.match(runtime, /SET employee_id = \?/);
  assert.match(runtime, /ownerCode/);
  assert.match(runtime, /This phone is linked to another employee account/);
});

test("worker app restores employee session and repairs registered phone", async () => {
  const [page, summaryRoute, runtime] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employee/summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/runtime.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /restoreEmployeeSession/);
  assert.match(page, /setUser\(toEmployeeUser\(result\.employee\)\)/);
  assert.match(page, /headers: \{ "x-device-fingerprint": getBrowserDeviceFingerprint\(\) \}/);
  assert.match(summaryRoute, /restoreEmployeeDevice/);
  assert.doesNotMatch(summaryRoute, /Employee phone access was deleted by HR/);
  assert.match(runtime, /resetOtherRegisteredEmployeeDevices/);
  assert.match(runtime, /status = 'reset'/);
});

test("verified employee auth refreshes current phone instead of blocking old device links", async () => {
  const [loginRoute, registerRoute, clockRoute] = await Promise.all([
    readFile(new URL("../app/api/auth/employee-login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/employee-register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/attendance/clock/route.ts", import.meta.url), "utf8"),
  ]);

  for (const route of [loginRoute, registerRoute, clockRoute]) {
    assert.match(route, /restoreEmployeeDevice/);
  }
  assert.doesNotMatch(loginRoute, /This employee account is linked to another phone/);
  assert.doesNotMatch(registerRoute, /This employee account is already linked to another phone/);
  assert.doesNotMatch(clockRoute, /Employee account is linked to another phone/);
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
  assert.match(page, /startLocationWatch/);
  assert.match(page, /watchPosition/);
  assert.match(page, /bestUsableWarehouseGpsSample/);
  assert.match(page, /Date\.now\(\) - startedAt < 20000/);
  assert.match(page, /GPS only returned/);
  assert.match(page, /gpsErrorMessage/);
  assert.match(page, /timestamp: position\.timestamp \|\| Date\.now\(\)/);
  assert.match(page, /Unable to read fresh phone GPS/);
  assert.doesNotMatch(page, /fallbackSample/);
  assert.doesNotMatch(page, /Location permission is needed/);
  assert.match(css, /\.scanner-modal/);
  assert.match(css, /\.live-camera-frame video/);
});
