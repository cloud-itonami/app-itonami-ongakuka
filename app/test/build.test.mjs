// Build pins identity, sources and output files, and the shipped descriptor
// must satisfy the vendored broker (per-operation consent, declared
// endpoints, restricted-wasm-v1 profile).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { build, CSP } from "../scripts/build.mjs";
import { clientRuntimeProblems } from "../vendor/kotoba-client-runtime.js";

const APP = fileURLToPath(new URL("../", import.meta.url));
const hex = /^[0-9a-f]{64}$/;

test("build pins identity, sources and output files", async () => {
  const { identity, release, data } = await build(APP);
  assert.equal(release.schema, "awai.app.artifact.v1");
  assert.equal(release.id, identity.id);
  assert.equal(release.id, "network.itonami.ongakuka");
  assert.equal(release.source, "app-itonami-ongakuka");
  assert.equal(release.version, data.version);
  assert.ok(hex.test(release.sources["blueprint.edn"]), "blueprint digest is pinned");
  assert.ok(hex.test(release.sources["src/ongakuka/view.cljk"]), "view source digest is pinned");
  assert.ok(hex.test(release.sources["src/ongakuka/route.cljk"]), "route source digest is pinned");
  for (const [name, digest] of Object.entries(release.files)) {
    assert.ok(hex.test(digest), `${name} digest is pinned`);
  }
  assert.equal(data.descriptor.profile, "restricted-wasm-v1");
  const caps = data.descriptor.operations.map((operation) => operation.capability);
  assert.deepEqual(
    clientRuntimeProblems(data.descriptor, caps, "tauri://localhost"),
    [],
    "the shipped descriptor must satisfy the vendored broker",
  );
  for (const operation of data.descriptor.operations) {
    assert.equal(operation.consent, "each-operation", `${operation.operation} requires each-operation consent`);
    assert.equal(operation.endpoint.origin, "https://ongakuka.etzhayyim.com");
  }
});

test("dist carries the rendered static page, not a hand-written one", async () => {
  await build(APP);
  const staticHtml = await readFile(join(APP, "dist/ongakuka-static.html"), "utf8");
  assert.ok(staticHtml.includes("Ongakuka — AI Music Generator"));
  assert.ok(staticHtml.includes('href="dds.css"'));
  assert.ok(!staticHtml.includes("<style>"), "dds.css is external (CSP-safe)");
  const index = await readFile(join(APP, "dist/index.html"), "utf8");
  assert.ok(index.startsWith("<!doctype html>"));
  assert.ok(index.includes('src="ongakuka-static.html"'));
  assert.ok(!index.includes("{{"), "index.html has no unfilled placeholder");
  assert.ok(index.includes("Content-Security-Policy"), "CSP is declared in the shell meta tag");
  assert.ok(index.includes(CSP));
  assert.ok(!staticHtml.includes(CSP), "the static page carries no CSP of its own");
});

test("tauri.conf.json csp matches the build CSP", async () => {
  const conf = JSON.parse(await readFile(join(APP, "src-tauri/tauri.conf.json"), "utf8"));
  assert.equal(conf.app.security.csp, CSP);
  assert.ok(CSP.includes("https://ongakuka.etzhayyim.com"));
});
