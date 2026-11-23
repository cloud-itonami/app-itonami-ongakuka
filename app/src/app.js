// Ongakuka WebView shell. All decisions are delegated to view.js; this file
// only wires the DOM, the network and storage. Every network call goes
// through `request()`, which enforces per-origin consent (default deny) and
// the descriptor's endpoint allow-list before sending anything.
import data from "./data.js";
import {
  TABS,
  tabFor,
  needsConsent,
  normalizeBaseUrl,
  xrpcUrl,
  parseConsentList,
  isApproved,
  approve,
  revoke,
  unwrapResponse,
  trackSummary,
  stemList,
  criticSummary,
  NSID_HEALTHY_PATH,
  NSID_COMPOSE,
  NSID_LIST_TRACKS,
  NSID_GET_TRACK,
} from "./view.js";
import { clientEndpointAllowsRequest } from "./vendor/kotoba-client-runtime.js";

const REQUEST_TIMEOUT_MS = 15_000;

/* ---------- storage ---------- */

function readRaw(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw === null || raw === undefined ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is best-effort: the app still renders when it throws.
  }
}

let approvedOrigins = parseConsentList(readRaw(data.consentKey));
let baseUrl = normalizeBaseUrl(readRaw(data.baseUrlKey)) ?? data.defaultBaseUrl;

/* ---------- consent ---------- */

const dialog = document.getElementById("consent-dialog");
let consentResolver = null;

function askConsent(origin) {
  document.getElementById("consent-text").textContent =
    `${origin} への通信を承認しますか？`;
  return new Promise((resolve) => {
    consentResolver = resolve;
    dialog.showModal();
  });
}

dialog.addEventListener("close", () => {
  const allowed = dialog.returnValue === "allow";
  if (allowed) {
    // The pending origin is recorded on the dialog's dataset by askConsent.
    approvedOrigins = approve(approvedOrigins, dialog.dataset.origin);
    writeRaw(data.consentKey, approvedOrigins);
  }
  consentResolver?.(allowed);
  consentResolver = null;
});

async function ensureConsent(origin) {
  if (!needsConsent(origin)) return true;
  if (isApproved(approvedOrigins, origin)) return true;
  dialog.dataset.origin = origin;
  return askConsent(origin);
}

/* ---------- network ---------- */

function originOf(url) {
  try {
    return new URL(url, globalThis.location?.origin).origin;
  } catch {
    return "";
  }
}

async function request({ method, path, body }) {
  const url = path.startsWith("/xrpc/") ? xrpcUrl(baseUrl, path.slice(6)) ?? null : `${baseUrl}${path}`;
  if (url === null) throw new Error("invalid request");
  const origin = originOf(url);
  if (!clientEndpointAllowsRequest(descriptorEndpoint(method, path), url, method)) {
    throw new Error(`endpoint not declared: ${url}`);
  }
  const consented = await ensureConsent(origin);
  if (!consented) throw new Error("denied by user");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
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

function descriptorEndpoint(method, path) {
  for (const operation of Object.values(data.descriptor.operations)) {
    const endpoint = operation.endpoint;
    if (endpoint.method !== method) continue;
    // Exact path, plus the single XRPC proxy pattern (path segment :nsid).
    if (endpoint.path === path) return endpoint;
    if (endpoint.path === "/xrpc/:nsid" && path.startsWith("/xrpc/")) return endpoint;
  }
  return { origin: originOf(baseUrl), method, path };
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
  out.textContent = "送信中…";
  try {
    const value = await request({
      method: "POST",
      path: `/xrpc/${NSID_COMPOSE}`,
      body: { projectId: title, title, lyrics, style },
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
  errors.textContent = "取得中…";
  try {
    const value = await request({
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
  body.textContent = "取得中…";
  try {
    const value = await request({
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

const settingsBase = document.getElementById("settings-base");
settingsBase.value = baseUrl;
document.getElementById("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const note = document.getElementById("settings-note");
  const normalized = normalizeBaseUrl(settingsBase.value);
  if (normalized === null) {
    note.textContent = "https:// の URL を入力してください。";
    return;
  }
  baseUrl = normalized;
  writeRaw(data.baseUrlKey, baseUrl);
  settingsBase.value = baseUrl;
  note.textContent = `保存しました: ${baseUrl}`;
  renderConsentList();
});

function renderConsentList() {
  const list = document.getElementById("consent-list");
  list.replaceChildren();
  const items = parseConsentList(approvedOrigins);
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "（承認済みの origin はありません）";
    list.appendChild(empty);
    return;
  }
  for (const origin of items) {
    const item = document.createElement("li");
    item.textContent = origin;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "取り消し";
    button.addEventListener("click", () => {
      approvedOrigins = revoke(approvedOrigins, origin);
      writeRaw(data.consentKey, approvedOrigins);
      renderConsentList();
    });
    item.appendChild(button);
    list.appendChild(item);
  }
}

renderConsentList();

// Health probe (GET /health) — the declared read-only operation.
export async function healthCheck() {
  return request({ method: "GET", path: NSID_HEALTHY_PATH });
}
