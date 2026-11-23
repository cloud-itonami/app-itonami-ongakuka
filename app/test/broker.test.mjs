// Broker-mediated send: deny → 0 requests, approve → exactly 1.
// These tests exercise src/broker.js (the only way the WebView can send)
// with a fake trusted document and a stub fetch. No real network, no
// production destination is ever contacted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createOngakukaBroker } from "../src/broker.js";

const APP = fileURLToPath(new URL("../", import.meta.url));

class FakeMouseEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.isTrusted = init.isTrusted === true;
    this.currentTarget = init.currentTarget ?? null;
  }
}

function fakeElement(tag) {
  const listeners = new Map();
  const el = {
    tag,
    listeners,
    open: false,
    isConnected: true,
    disabled: false,
    textContent: "",
    className: "",
    dataset: {},
    attributes: {},
    children: [],
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    dispatch(type, event) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    append(...children) { this.children = children; },
    remove() {},
    focus() {},
  };
  return el;
}

function fakeDialog() {
  const el = fakeElement("dialog");
  el.showModal = function () { this.open = true; };
  el.close = function () {
    this.open = false;
    this.dispatch("close", { type: "close" });
  };
  return el;
}

function fakeWorld(nowRef) {
  const created = [];
  const body = fakeElement("body");
  const doc = {
    body,
    defaultView: {
      performance: { now: () => nowRef.value },
      MouseEvent: FakeMouseEvent,
    },
    createElement(tag) {
      const el = tag === "dialog" ? fakeDialog() : fakeElement(tag);
      created.push(el);
      return el;
    },
  };
  const dialog = () => created.find((el) => el.tag === "dialog");
  const findByText = (text) => created.find((el) => el.textContent === text);
  return { doc, dialog, findByText };
}

// Test-only stub origin. descriptor endpoints carry the production origin;
// for the deny/approve measurement this test swaps in a test descriptor
// whose endpoints point at the stub origin, so nothing can ever reach
// ongakuka.etzhayyim.com (the fetch is stubbed in any case).
const STUB_ORIGIN = "https://localhost:8787";

function stubDescriptor(realDescriptor) {
  return {
    ...realDescriptor,
    operations: realDescriptor.operations.map((operation) => ({
      ...operation,
      endpoint: { ...operation.endpoint, origin: STUB_ORIGIN },
    })),
  };
}

async function buildBroker(nowRef, calls) {
  const fake = fakeWorld(nowRef);
  const previousDocument = globalThis.document;
  globalThis.document = fake.doc;
  const realDescriptor = JSON.parse(await readFile(join(APP, "dist/descriptor.json"), "utf8"));
  const descriptor = stubDescriptor(realDescriptor);
  const stubFetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    const method = typeof input?.method === "string" ? input.method : "GET";
    const body =
      input !== null && typeof input === "object" && typeof input.text === "function"
        ? await input.clone().text()
        : "";
    calls.push({ url, method, body });
    return {
      type: "default",
      status: 200,
      ok: true,
      url,
      body: null,
      text: async () => JSON.stringify({ uri: "at://did:plc:x/track/1", status: "queued" }),
    };
  };
  const broker = createOngakukaBroker({ document: fake.doc, descriptor, fetchImpl: stubFetch });
  return { fake, broker, previousDocument };
}

function composeRequest(descriptor) {
  const operation = descriptor.operations.find((entry) => entry.operation === "compose");
  return {
    selector: {
      capability: operation.capability,
      service: operation.service,
      operation: operation.operation,
    },
    payload: {
      input: `${STUB_ORIGIN}/xrpc/com.etzhayyim.ongakuka.compose`,
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", lyrics: "l", style: "s" }),
      },
    },
  };
}

test("deny sends zero requests", async () => {
  const nowRef = { value: 1000 };
  const calls = [];
  const { fake, broker, previousDocument } = await buildBroker(nowRef, calls);
  try {
    const descriptor = JSON.parse(await readFile(join(APP, "dist/descriptor.json"), "utf8"));
    const { selector, payload } = composeRequest(descriptor);
    const invokePromise = broker.invoke(selector, payload, {});
    // Let the invoke reach the consent dialog.
    await new Promise((resolve) => setImmediate(resolve));
    const dialog = fake.dialog();
    assert.equal(dialog.open, true, "the trusted consent dialog was shown");
    const scope = dialog.children[1];
    assert.ok(scope.textContent.includes(STUB_ORIGIN), "dialog shows the stub endpoint");
    assert.ok(scope.textContent.includes("lyrics"), "dialog shows the data categories");
    const denyButton = fake.findByText("Deny");
    assert.ok(denyButton, "deny button exists");
    denyButton.dispatch("click", { isTrusted: true });
    await assert.rejects(invokePromise, /not approved/);
    assert.equal(calls.length, 0, "deny → 0 requests were sent");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("approve sends exactly one broker-scoped request", async () => {
  const nowRef = { value: 1000 };
  const calls = [];
  const { fake, broker, previousDocument } = await buildBroker(nowRef, calls);
  try {
    const descriptor = JSON.parse(await readFile(join(APP, "dist/descriptor.json"), "utf8"));
    const { selector, payload } = composeRequest(descriptor);
    const invokePromise = broker.invoke(selector, payload, {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fake.dialog().open, true);
    // The Allow arm opens 600ms after show; advance the fake clock past it.
    nowRef.value += 1000;
    const allowButton = fake.findByText("Allow once");
    assert.ok(allowButton, "allow button exists");
    allowButton.dispatch("pointerdown", { isTrusted: true });
    allowButton.dispatch(
      "click",
      new FakeMouseEvent("click", { isTrusted: true, currentTarget: allowButton }),
    );
    const response = await invokePromise;
    assert.equal(response.ok, true);
    assert.equal(calls.length, 1, "approve → exactly 1 request");
    assert.equal(calls[0].url, `${STUB_ORIGIN}/xrpc/com.etzhayyim.ongakuka.compose`);
    assert.ok(
      calls.every((call) => !call.url.includes("ongakuka.etzhayyim.com")),
      "no request ever addressed the production origin",
    );
    assert.equal(calls[0].method, "POST");
    assert.deepEqual(JSON.parse(calls[0].body), { title: "t", lyrics: "l", style: "s" });
  } finally {
    globalThis.document = previousDocument;
  }
});
