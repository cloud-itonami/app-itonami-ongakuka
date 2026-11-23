// view.js is pure: tabs, consent, URL building and response unwrapping are
// decided without the DOM, the network or storage.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TABS,
  tabFor,
  needsConsent,
  normalizeBaseUrl,
  xrpcUrl,
  parseConsentList,
  isApproved,
  revoke,
  unwrapResponse,
  trackSummary,
  stemList,
  criticSummary,
} from "../src/view.js";

test("tabs cover the screen inventory (mobile 390x844)", () => {
  assert.deepEqual(
    TABS.map((tab) => tab.id),
    ["about", "compose", "list", "detail", "settings"],
  );
  assert.equal(tabFor("compose").label, "作曲");
  assert.equal(tabFor("unknown").id, "about", "unknown ids fall back to the first tab");
});

test("consent is deny-by-default and local origins are exempt", () => {
  assert.equal(needsConsent("https://ongakuka.etzhayyim.com"), true);
  assert.equal(needsConsent("tauri://localhost"), false);
  assert.equal(needsConsent("appassets://localhost"), false);
  assert.equal(needsConsent(""), false);
  assert.equal(isApproved([], "https://ongakuka.etzhayyim.com"), false);
  assert.equal(isApproved(["https://ongakuka.etzhayyim.com"], "https://ongakuka.etzhayyim.com"), true);
  assert.equal(isApproved(parseConsentList(["https://a", "https://a", 42, ""]), "https://a"), true);
  assert.deepEqual(revoke(["https://a", "https://b"], "https://a"), ["https://b"]);
  assert.deepEqual(parseConsentList(null), []);
  assert.deepEqual(parseConsentList("https://a"), []);
});

test("base URL is https-only and trailing-slash-free", () => {
  assert.equal(normalizeBaseUrl("https://ongakuka.etzhayyim.com/"), "https://ongakuka.etzhayyim.com");
  assert.equal(normalizeBaseUrl(""), "https://ongakuka.etzhayyim.com");
  assert.equal(normalizeBaseUrl(null), "https://ongakuka.etzhayyim.com");
  assert.equal(normalizeBaseUrl("http://ongakuka.etzhayyim.com"), null);
  assert.equal(normalizeBaseUrl("not a url"), null);
  assert.equal(
    xrpcUrl("https://ongakuka.etzhayyim.com", "com.etzhayyim.ongakuka.listTracks"),
    "https://ongakuka.etzhayyim.com/xrpc/com.etzhayyim.ongakuka.listTracks",
  );
  assert.equal(xrpcUrl("http://evil", "com.a.b"), null);
});

test("unwrap mirrors route.cljk unwrap-mcp", () => {
  assert.deepEqual(unwrapResponse({ result: { structuredContent: { a: 1 } } }), {
    ok: true,
    value: { a: 1 },
  });
  assert.deepEqual(unwrapResponse({ result: { a: 1 } }), { ok: true, value: { a: 1 } });
  assert.equal(unwrapResponse({ error: { message: "boom" } }).ok, false);
  assert.equal(unwrapResponse({ error: "boom" }).error, "boom");
  assert.deepEqual(unwrapResponse([1, 2]), { ok: true, value: [1, 2] });
});

test("track / stem / critic shapes are best-effort", () => {
  const summary = trackSummary({ projectId: "p1", title: "朝の光", status: "published" });
  assert.deepEqual(summary, { projectId: "p1", uri: null, title: "朝の光", status: "published" });
  assert.equal(trackSummary(null).title, "(無題)");
  const stems = stemList({
    stems: [
      { blobKey: "b1", kind: "vocal", actorDid: "did:web:ongakuka.etzhayyim.com:actor:vocalist", url: "https://b2.example/v" },
    ],
  });
  assert.equal(stems.length, 1);
  assert.equal(stems[0].actorDid, "did:web:ongakuka.etzhayyim.com:actor:vocalist");
  assert.equal(criticSummary({}), null);
  const critic = criticSummary({ critic: { verdict: "ok", clapScore: 0.5, flags: ["pii"], note: "n" } });
  assert.deepEqual(critic, { verdict: "ok", clapScore: 0.5, flags: ["pii"], note: "n" });
});
