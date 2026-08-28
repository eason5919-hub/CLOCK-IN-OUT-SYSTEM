import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("leave requests notify WhatsApp recipients from the Worker", async () => {
  const route = await readFile(new URL("../app/api/leave-requests/route.ts", import.meta.url), "utf8");

  assert.match(route, /DEFAULT_WHATSAPP_RECIPIENTS = \["60122159225", "60177395919"\]/);
  assert.match(route, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(route, /WHATSAPP_PHONE_NUMBER_ID/);
  assert.match(route, /graph\.facebook\.com/);
  assert.match(route, /messaging_product: "whatsapp"/);
  assert.match(route, /type: "text"/);
  assert.match(route, /notifyWhatsApp === false/);
  assert.match(route, /Annual Leave\/MC request/);
  assert.match(route, /Reason is required for Annual Leave\/MC\./);
  assert.match(route, /Reason: \$\{payload\.reason\}/);
  assert.match(route, /Working days submitted/);
});

test("employee app opens one WhatsApp number after leave submit", async () => {
  const [script, css] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../style.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /WHATSAPP_NOTIFY_NUMBER = "60122159225"/);
  assert.match(script, /function leaveWhatsAppMessage/);
  assert.match(script, /Annual Leave\/MC request/);
  assert.match(script, /leaveWhatsAppDateLines/);
  assert.match(script, /Reason: \$\{reason\}/);
  assert.match(script, /Working days submitted: \$\{formatLeaveSubmittedDays/);
  assert.match(script, /return line/);
  assert.match(script, /leaveSubmittedDayValue\(date, duration\)/);
  assert.match(script, /notifyWhatsApp: false/);
  assert.match(script, /openWhatsAppMessage\(WHATSAPP_NOTIFY_NUMBER/);
  assert.match(script, /toLowerCase\(\) === "mc"\) return "MC"/);
  assert.doesNotMatch(script, /data-whatsapp-notify/);
  assert.doesNotMatch(script, /60177395919/);
  assert.match(script, /https:\/\/wa\.me\/\$\{phone\}/);
  assert.doesNotMatch(css, /\.whatsapp-notice/);
  assert.doesNotMatch(script, /WhatsApp API is not configured/);
});
