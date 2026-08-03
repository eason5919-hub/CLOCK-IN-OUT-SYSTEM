import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

test("builds the warehouse attendance console assets", async () => {
  const [server, pageChunk, layout] = await Promise.all([
    readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"),
    readBuiltPageChunk(),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /Warehouse Attendance Management/);
  assert.match(server, /Warehouse Attendance Management/);
  assert.match(pageChunk, /Register Official Phone/);
  assert.match(pageChunk, /Employee Login/);
  assert.match(pageChunk, /Owner\/Admin/);
  assert.match(pageChunk, /HR\/Admin Staff/);
  assert.match(pageChunk, /Clock In/);
  assert.match(pageChunk, /QR and GPS settings/);
  assert.match(pageChunk, /Correction requests/);
  assert.doesNotMatch(pageChunk, /Switch role/);
  assert.doesNotMatch(server + pageChunk, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps starter preview files removed", async () => {
  const [page, layout, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Clock In/);
  assert.match(page, /collectGpsSamples/);
  assert.match(layout, /Warehouse Attendance Management/);
  assert.match(hosting, /"d1": "DB"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);

  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/_sites-preview/preview.css", templateRoot)));
});

async function readBuiltPageChunk() {
  const assetsRoot = new URL("../dist/server/ssr/assets/", import.meta.url);
  const file = (await readdir(assetsRoot)).find((name) => /^page-.*\.js$/.test(name));
  assert.ok(file, "Expected built page chunk");
  return readFile(new URL(file, assetsRoot), "utf8");
}
