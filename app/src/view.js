// Pure view model for the Ongakuka WebView shell. Nothing here touches the
// DOM, the network or localStorage directly, so node tests can call every
// function in this file directly. app.js is the only module that performs
// I/O; it delegates every decision to the functions here.

export const TAB_ABOUT = "about";
export const TAB_COMPOSE = "compose";
export const TAB_LIST = "list";
export const TAB_DETAIL = "detail";
export const TAB_SETTINGS = "settings";

export const TABS = [
  { id: TAB_ABOUT, label: "概要" },
  { id: TAB_COMPOSE, label: "作曲" },
  { id: TAB_LIST, label: "一覧" },
  { id: TAB_DETAIL, label: "詳細" },
  { id: TAB_SETTINGS, label: "設定" },
];

/** The tab for an id, falling back to the first tab for unknown ids. */
export function tabFor(id) {
  return TABS.find((tab) => tab.id === id) ?? TABS[0];
}

/* Consent: each send asks through the broker (broker.js). The page itself
   holds no destination editable here and never sends on its own. */

export const DEFAULT_BASE_URL = "https://ongakuka.etzhayyim.com";

/** A base URL is usable only as an https origin (no trailing slash). */
export function normalizeBaseUrl(value) {
  if (typeof value !== "string") return DEFAULT_BASE_URL;
  const trimmed = value.trim();
  if (trimmed.length === 0) return DEFAULT_BASE_URL;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Build the XRPC proxy URL for one NSID. Returns null for a bad NSID. */
export function xrpcUrl(baseUrl, nsid) {
  const base = normalizeBaseUrl(baseUrl);
  if (base === null || typeof nsid !== "string" || nsid.length === 0) return null;
  return `${base}/xrpc/${nsid}`;
}

export const NSID_HEALTHY_PATH = "/health";
export const NSID_COMPOSE = "com.etzhayyim.ongakuka.compose";
export const NSID_LIST_TRACKS = "com.etzhayyim.ongakuka.listTracks";
export const NSID_GET_TRACK = "com.etzhayyim.ongakuka.getTrack";

/**
 * Unwrap a Worker / MCP-router response body, mirroring
 * src/ongakuka/route.cljk `unwrap-mcp`: {:result {:structuredContent X}} → X,
 * {:result X} → X, {:error …} is reported as an error.
 */
export function unwrapResponse(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: true, value: payload };
  }
  if (Object.hasOwn(payload, "error")) {
    const error = payload.error;
    const message =
      error !== null && typeof error === "object" && typeof error.message === "string"
        ? error.message
        : typeof error === "string"
          ? error
          : "request failed";
    return { ok: false, error: message, upstream: payload };
  }
  if (Object.hasOwn(payload, "result")) {
    const result = payload.result;
    if (result !== null && typeof result === "object" && Object.hasOwn(result, "structuredContent")) {
      return { ok: true, value: result.structuredContent };
    }
    return { ok: true, value: result };
  }
  return { ok: true, value: payload };
}

/** Shape a track record for the list/detail screens. Fields are best-effort. */
export function trackSummary(track) {
  const t = track !== null && typeof track === "object" ? track : {};
  return {
    projectId: typeof t.projectId === "string" ? t.projectId : null,
    uri: typeof t.uri === "string" ? t.uri : typeof t.trackUri === "string" ? t.trackUri : null,
    title: typeof t.title === "string" && t.title.length > 0 ? t.title : "(無題)",
    status: typeof t.status === "string" ? t.status : "unknown",
  };
}

/** Stem list for the detail mixer, with actor attribution (AGENTS.md: PRODUCED_BY). */
export function stemList(track) {
  const stems = track !== null && typeof track === "object" && Array.isArray(track.stems)
    ? track.stems
    : [];
  return stems.map((stem, index) => {
    const s = stem !== null && typeof stem === "object" ? stem : {};
    return {
      key: typeof s.blobKey === "string" ? s.blobKey : `stem-${index}`,
      label: typeof s.kind === "string" ? s.kind : typeof s.name === "string" ? s.name : `stem-${index}`,
      actorDid: typeof s.actorDid === "string" ? s.actorDid : null,
      url: typeof s.url === "string" ? s.url : null,
    };
  });
}

/** Critic verdict for the detail screen, or null when unevaluated. */
export function criticSummary(track) {
  const critic = track !== null && typeof track === "object" ? track.critic : null;
  if (critic === null || typeof critic !== "object") return null;
  return {
    verdict: typeof critic.verdict === "string" ? critic.verdict : null,
    clapScore: typeof critic.clapScore === "number" ? critic.clapScore : null,
    flags: Array.isArray(critic.flags) ? critic.flags.filter((flag) => typeof flag === "string") : [],
    note: typeof critic.note === "string" ? critic.note : null,
  };
}
