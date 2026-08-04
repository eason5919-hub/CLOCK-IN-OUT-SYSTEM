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
});

test("employee app falls back to WhatsApp buttons when API is not configured", async () => {
  const [script, css] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../style.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /WHATSAPP_NOTIFY_NUMBERS = \["60122159225", "60177395919"\]/);
  assert.match(script, /function leaveWhatsAppMessage/);
  assert.match(script, /notifyWhatsApp: !whatsappAttempted/);
  assert.match(script, /data-whatsapp-notify/);
  assert.match(script, /https:\/\/wa\.me\/\$\{phone\}/);
  assert.match(css, /\.whatsapp-notice/);
});
