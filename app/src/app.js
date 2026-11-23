// Ongakuka WebView shell. All decisions are delegated to view.js; this file
// only wires the DOM, the network and storage. Every network call goes
// through the broker (broker.js): the page only states what to send, the
// broker validates the descriptor scope, asks the trusted consent host and
// dispatches the captured fetch. Nothing is ever fetched directly.
import data from "./data.js";
import {
  TABS,
  tabFor,
  normalizeBaseUrl,
  xrpcUrl,
  unwrapResponse,
  trackSummary,
  stemList,
  criticSummary,
  NSID_HEALTHY_PATH,
  NSID_COMPOSE,
  NSID_LIST_TRACKS,
  NSID_GET_TRACK,
} from "./view.js";
import { createOngakukaBroker } from "./broker.js";

const REQUEST_TIMEOUT_MS = 15_000;
const BASE_URL = normalizeBaseUrl(data.defaultBaseUrl) ?? data.defaultBaseUrl;

const broker = createOngakukaBroker({
  document: globalThis.document,
  descriptor: data.descriptor,
});

function operationByName(name) {
  const operation = data.descriptor.operations.find((entry) => entry.operation === name);
  if (!operation) throw new Error(`operation not declared: ${name}`);
  return operation;
}

function invokeUrl(path) {
  if (!path.startsWith("/xrpc/")) return `${BASE_URL}${path}`;
  return xrpcUrl(BASE_URL, path.slice(6));
}

/**
 * Send one declared operation through the broker. Fails closed: any broker
 * refusal (unapproved consent, undeclared scope, missing trusted document)
 * is thrown and nothing was sent.
 */
async function request({ operation, method, path, body }) {
  const operationEntry = operationByName(operation);
  const url = invokeUrl(path);
  const init = body === undefined
    ? { method }
    : {
        method,
        headers: { "content-type": "application/json" },
        // Minimal body: only the fields the endpoint needs, nothing else.
        body: JSON.stringify(body),
      };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await broker.invoke(
      {
        capability: operationEntry.capability,
        service: operationEntry.service,
        operation: operationEntry.operation,
      },
      { input: url, init },
      { signal: controller.signal },
    );
    const text = await response.text();
    let payload = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    const unwrapped = unwrapResponse(payload);
    if (!response.ok) {
      throw new Error(
        unwrapped.ok === false ? unwrapped.error : `HTTP ${response.status}`,
      );
    }
    if (unwrapped.ok === false) throw new Error(unwrapped.error);
    return unwrapped.value;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- tabs ---------- */

const nav = document.getElementById("tabs");
const sections = [...document.querySelectorAll("main section")];
const buttons = new Map();
for (const tab of TABS) {
  const button = document.createElement("button");
  button.setAttribute("role", "tab");
  button.id = `tab-${tab.id}`;
  button.textContent = tab.label;
  button.addEventListener("click", () => select(tab.id));
  nav.appendChild(button);
  buttons.set(tab.id, button);
}

function select(id) {
  const tab = tabFor(id);
  for (const other of TABS) {
    const active = other.id === tab.id;
    buttons.get(other.id).setAttribute("aria-selected", String(active));
    buttons.get(other.id).tabIndex = active ? 0 : -1;
    const section = sections.find((node) => node.dataset.tab === other.id);
    if (section) section.hidden = !active;
  }
}

select(data.defaultTab);

/* ---------- compose ---------- */

document.getElementById("compose-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const out = document.getElementById("compose-result");
  const title = document.getElementById("compose-title").value.trim();
  const lyrics = document.getElementById("compose-lyrics").value.trim();
  const style = document.getElementById("compose-style").value.trim();
  if (lyrics.length === 0) {
    out.textContent = "歌詞が空です。歌詞を入力してから送信してください。";
    return;
  }
  out.textContent = "送信中…（broker の承認ダイアログで宛先と内容を確認してください）";
  try {
    // Minimal body: 曲名・歌詞・style prompt のみ。個人情報を足さない。
    const value = await request({
      operation: "compose",
      method: "POST",
      path: `/xrpc/${NSID_COMPOSE}`,
      body: { title, lyrics, style },
    });
    out.textContent = `依頼を受け付けました: ${JSON.stringify(value).slice(0, 400)}`;
    document.getElementById("detail-id").value =
      value?.projectId ?? value?.uri ?? value?.trackUri ?? "";
  } catch (error) {
    out.textContent = `送信できませんでした: ${error.message}`;
  }
});

/* ---------- list ---------- */

document.getElementById("list-reload").addEventListener("click", async () => {
  const list = document.getElementById("track-list");
  const errors = document.getElementById("list-error");
  list.replaceChildren();
  errors.textContent = "取得中…（broker の承認ダイアログで宛先と内容を確認してください）";
  try {
    const value = await request({
      operation: "list-tracks",
      method: "POST",
      path: `/xrpc/${NSID_LIST_TRACKS}`,
      body: { offset: 0, limit: 20 },
    });
    const tracks = Array.isArray(value?.tracks)
      ? value.tracks
      : Array.isArray(value?.items)
        ? value.items
        : Array.isArray(value)
          ? value
          : [];
    errors.textContent = tracks.length === 0 ? "曲はまだありません。" : "";
    for (const track of tracks) {
      const summary = trackSummary(track);
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${summary.title} (${summary.status})`;
      button.addEventListener("click", () => {
        document.getElementById("detail-id").value = summary.projectId ?? summary.uri ?? "";
        select("detail");
      });
      item.appendChild(button);
      list.appendChild(item);
    }
  } catch (error) {
    errors.textContent = `一覧を取得できませんでした: ${error.message}`;
  }
});

/* ---------- detail ---------- */

document.getElementById("detail-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = document.getElementById("detail-body");
  const trackId = document.getElementById("detail-id").value.trim();
  if (trackId.length === 0) {
    body.textContent = "projectId を入力してください。";
    return;
  }
  body.textContent = "取得中…（broker の承認ダイアログで宛先と内容を確認してください）";
  try {
    const value = await request({
      operation: "get-track",
      method: "POST",
      path: `/xrpc/${NSID_GET_TRACK}`,
      body: { projectId: trackId },
    });
    const track = value?.track ?? value;
    body.replaceChildren();
    const summary = trackSummary(track);
    const heading = document.createElement("p");
    heading.textContent = `${summary.title} — ${summary.status}`;
    body.appendChild(heading);

    // Stem mixer: one <audio> per stem with a volume range input.
    const stems = stemList(track);
    if (stems.length > 0) {
      const mixHeading = document.createElement("h3");
      mixHeading.textContent = "Stem ミキサー";
      body.appendChild(mixHeading);
      for (const stem of stems) {
        const row = document.createElement("div");
        row.className = "stem-row";
        const label = document.createElement("span");
        label.textContent = stem.actorDid ? `${stem.label} (${stem.actorDid})` : stem.label;
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "metadata";
        if (stem.url) audio.src = stem.url;
        const volume = document.createElement("input");
        volume.type = "range";
        volume.min = "0";
        volume.max = "1";
        volume.step = "0.05";
        volume.value = "1";
        volume.setAttribute("aria-label", `${stem.label} の音量`);
        volume.addEventListener("input", () => {
          audio.volume = Number(volume.value);
        });
        row.append(label, audio, volume);
        body.appendChild(row);
      }
    }

    // Critic feedback (CLAP score + flags).
    const critic = criticSummary(track);
    const criticHeading = document.createElement("h3");
    criticHeading.textContent = "Critic";
    body.appendChild(criticHeading);
    const criticText = document.createElement("p");
    if (critic === null) {
      criticText.textContent = "未評価です。";
    } else {
      const bits = [];
      if (critic.verdict) bits.push(`判定: ${critic.verdict}`);
      if (critic.clapScore !== null) bits.push(`CLAP: ${critic.clapScore}`);
      if (critic.flags.length > 0) bits.push(`フラグ: ${critic.flags.join(", ")}`);
      if (critic.note) bits.push(critic.note);
      criticText.textContent = bits.length > 0 ? bits.join(" / ") : "未評価です。";
    }
    body.appendChild(criticText);
  } catch (error) {
    body.textContent = `取得できませんでした: ${error.message}`;
  }
});

/* ---------- settings ---------- */

// The endpoint origin is declared in the descriptor and enforced by the
// broker; there is nothing to edit (an editable destination would be an
// undeclared scope, and the broker refuses to send to it).
document.getElementById("settings-origin").textContent = BASE_URL;
document.getElementById("settings-id").textContent = data.identity.id;
document.getElementById("settings-version").textContent = data.version;

const opsList = document.getElementById("ops-list");
for (const operation of data.descriptor.operations) {
  const item = document.createElement("li");
  const label = document.createElement("span");
  label.textContent =
    `${operation.operation} — ${operation.endpoint.method} ${operation.endpoint.origin}${operation.endpoint.path}` +
    `（データ: ${operation["data-categories"].length > 0 ? operation["data-categories"].join(", ") : "なし"}）`;
  item.appendChild(label);
  opsList.appendChild(item);
}

// Health probe (GET /health) — the declared read-only operation.
export async function healthCheck() {
  return request({ operation: "health", method: "GET", path: NSID_HEALTHY_PATH });
}
