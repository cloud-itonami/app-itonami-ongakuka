// Static build: dist/ is the whole app (HTML, CSS, JS) for the Tauri v3 shell.
// The about page is NOT hand-written: it is the hiccup in ../src/ongakuka/
// view.cljk rendered at build time by the repo's documented render procedure
// (docs/operator-quickstart.md section 3, kbb --backend sci with the
// jp-go-digital-design-system sources on the classpath). The app carries no
// second, hand-written copy of that page; if the toolchain or the checkouts
// are missing, the build fails instead of shipping a stale snapshot.
import { mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

export const TAURI = "3.0.0-alpha.6";
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; media-src 'self' data: https:; connect-src https://ongakuka.etzhayyim.com https://ong4k4k4.etzhayyim.com ipc: http://ipc.localhost; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

const ID = "network.itonami.ongakuka";
const TITLE = "Ongakuka — AI Music Generator";
const WORKER_ORIGIN = "https://ongakuka.etzhayyim.com";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function findKbb() {
  return firstExisting([
    process.env.KOTOBA_KBB,
    resolve(homedir(), "github/repos/kotoba-lang/kotoba/bin/kbb"),
  ]);
}

function findKotobaLib() {
  return firstExisting([
    process.env.KOTOBA_LIB,
    resolve(homedir(), "github/repos/kotoba-lang/kotoba/lib"),
  ]);
}

function findJpDds() {
  return firstExisting([
    process.env.KOTOBA_JP_DDS,
    resolve(homedir(), "github/repos/kotoba-lang/jp-go-digital-design-system"),
  ]);
}

const RENDER_SCRIPT = `(require '["node:fs" :as fs] '[ongakuka.view :as view] '[ongakuka.route :as route])
(let [css (.readFileSync fs (str (.-DDS js/process.env) "/resources/jp_go_dds/dds.css") "utf8")]
  (.writeFileSync fs (str (.-OUT js/process.env) "/ongakuka-static.html")
    (view/render {:css css :routes route/routes
                  :vars [:APP_NANOID :APP_UI_TYPE]
                  :mcp-url "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}))
  (println "render ok"))
`;

async function renderStatic(repo) {
  const kbb = findKbb();
  const lib = findKotobaLib();
  const dds = findJpDds();
  if (!kbb || !lib || !dds) {
    throw new Error(
      "static render needs the kotoba checkouts on PATH check: " +
        "~/github/repos/kotoba-lang/{kotoba,jp-go-digital-design-system} (or KOTOBA_KBB/KOTOBA_LIB/KOTOBA_JP_DDS)",
    );
  }
  const classpath = [
    join(repo, "src"),
    join(dds, "src"),
    join(lib, "kotoba.text", "src"),
    join(lib, "kotoba.html", "src"),
    join(lib, "kotoba.css", "src"),
  ].join(":");
  const scriptPath = join(repo, ".cache", "render-static.cljs");
  const outDir = join(repo, ".cache", "render");
  await mkdir(join(repo, ".cache"), { recursive: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(scriptPath, RENDER_SCRIPT, "utf8");
  const result = spawnSync(kbb, ["--backend", "sci", "--classpath", classpath, scriptPath], {
    cwd: repo,
    env: { ...process.env, DDS: dds, OUT: outDir },
    encoding: "utf8",
    timeout: 240_000,
  });
  const rendered = join(outDir, "ongakuka-static.html");
  if (!existsSync(rendered)) {
    throw new Error(
      `static render failed (exit ${result.status}): ${(result.stdout ?? "").slice(-2000)} ${(result.stderr ?? "").slice(-2000)}`,
    );
  }
  return readFile(rendered);
}

export async function build(appRoot = fileURLToPath(new URL("../", import.meta.url))) {
  const repo = resolve(appRoot, "..");
  const out = resolve(appRoot, "dist");
  const meta = JSON.parse(await readFile(resolve(appRoot, "package.json"), "utf8"));

  const pins = JSON.parse(await readFile(resolve(appRoot, "vendor/PINS.json"), "utf8"));
  for (const [name, digest] of Object.entries(pins.files)) {
    if (sha(await readFile(resolve(appRoot, "vendor", name))) !== digest) {
      throw new Error(`canonical runtime pin drift: ${name}`);
    }
  }

  const expect = (what, got, want) => {
    if (got !== want) throw new Error(`${what} is ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  expect("package.json itonami.id", meta.itonami?.id, ID);
  expect("package.json itonami.title", meta.itonami?.title, TITLE);
  expect("package.json itonami.runtime", meta.itonami?.runtime, "restricted-wasm-v1");
  expect("package.json itonami.source", meta.itonami?.source, "app-itonami-ongakuka");

  const conf = JSON.parse(await readFile(resolve(appRoot, "src-tauri/tauri.conf.json"), "utf8"));
  expect("tauri.conf.json identifier", conf.identifier, ID);
  expect("tauri.conf.json productName", conf.productName, TITLE);
  expect("tauri.conf.json window title", conf.app?.windows?.[0]?.title, TITLE);
  expect("tauri.conf.json version", conf.version, meta.version);
  expect("tauri.conf.json csp", conf.app?.security?.csp, CSP);

  // Provenance pins for the files the static page and the UI are derived from.
  const sources = {};
  for (const rel of [
    "blueprint.edn",
    "src/ongakuka/route.cljk",
    "src/ongakuka/view.cljk",
    "app/src/app.js",
    "app/src/index.html",
    "app/src/style.css",
    "app/src/view.js",
  ]) {
    sources[rel] = sha(await readFile(resolve(repo, rel)));
  }

  // 1) Static about page from view.cljk (hiccup → HTML at build time).
  const rendered = (await renderStatic(repo)).toString("utf8");
  const styleMatch = rendered.match(/<style>([\s\S]*?)<\/style>/);
  if (!styleMatch) throw new Error("rendered static page has no <style> block to extract");
  const ddsCss = styleMatch[1];
  const staticHtml = rendered.replace(
    /<style>[\s\S]*?<\/style>/,
    '<link rel="stylesheet" href="dds.css">',
  );
  if (staticHtml.includes("<style>") || staticHtml.includes("{{")) {
    throw new Error("rendered static page still carries inline style or a placeholder");
  }

  const descriptor = {
    schema: "kotoba.app.client-runtime.v1",
    target: "browser",
    profile: "restricted-wasm-v1",
    entry: "index.html",
    "local-state": { adapter: "localstorage", schema: "ongakuka.local.v1", version: 1 },
    workers: [],
    operations: [
      {
        capability: "music-generation/compose",
        service: "ongakuka-worker",
        operation: "compose",
        consent: "each-operation",
        "data-categories": ["lyrics", "style-prompt"],
        endpoint: { origin: WORKER_ORIGIN, method: "POST", path: "/xrpc/com.etzhayyim.ongakuka.compose" },
      },
      {
        capability: "music-generation/list-tracks",
        service: "ongakuka-worker",
        operation: "list-tracks",
        consent: "each-operation",
        "data-categories": [],
        endpoint: { origin: WORKER_ORIGIN, method: "POST", path: "/xrpc/com.etzhayyim.ongakuka.listTracks" },
      },
      {
        capability: "music-generation/get-track",
        service: "ongakuka-worker",
        operation: "get-track",
        consent: "each-operation",
        "data-categories": ["track-id"],
        endpoint: { origin: WORKER_ORIGIN, method: "POST", path: "/xrpc/com.etzhayyim.ongakuka.getTrack" },
      },
      {
        capability: "music-generation/health",
        service: "ongakuka-worker",
        operation: "health",
        consent: "each-operation",
        "data-categories": [],
        endpoint: { origin: WORKER_ORIGIN, method: "GET", path: "/health" },
      },
    ],
  };

  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "vendor"), { recursive: true });

  const staticBytes = Buffer.byteLength(staticHtml, "utf8");
  const index = (await readFile(resolve(appRoot, "src/index.html"), "utf8"))
    .replaceAll("{{CSP}}", CSP)
    .replaceAll("{{TITLE}}", TITLE)
    .replaceAll("{staticBytes}", String(staticBytes));
  if (index.includes("{{")) throw new Error("index.html has an unfilled placeholder");
  await writeFile(join(out, "index.html"), index);
  await writeFile(join(out, "ongakuka-static.html"), staticHtml);
  await writeFile(join(out, "dds.css"), ddsCss);
  for (const name of ["style.css", "app.js", "view.js"]) {
    await copyFile(resolve(appRoot, "src", name), join(out, name));
  }
  await copyFile(resolve(appRoot, "vendor/kotoba-client-runtime.js"), join(out, "vendor/kotoba-client-runtime.js"));
  await copyFile(resolve(appRoot, "vendor/kotoba-client-consent.css"), join(out, "vendor/kotoba-client-consent.css"));

  const data = {
    identity: { id: ID, title: TITLE, source: meta.itonami.source },
    version: meta.version,
    defaultTab: "about",
    defaultBaseUrl: WORKER_ORIGIN,
    consentKey: "ongakuka.consent.origins",
    baseUrlKey: "ongakuka.worker.base",
    descriptor,
    sources,
  };
  await writeFile(join(out, "data.js"), `export default ${JSON.stringify(data, null, 1)};\n`);
  await writeFile(join(out, "descriptor.json"), JSON.stringify(descriptor, null, 2) + "\n");

  const names = [
    "index.html", "style.css", "app.js", "view.js", "data.js", "descriptor.json",
    "ongakuka-static.html", "dds.css",
    "vendor/kotoba-client-runtime.js", "vendor/kotoba-client-consent.css",
  ];
  const files = {};
  for (const name of names) files[name] = sha(await readFile(join(out, name)));
  const release = {
    schema: "awai.app.artifact.v1",
    id: ID, source: meta.itonami.source, title: TITLE, version: meta.version, tauri: TAURI,
    runtimePins: pins, sources, files,
  };
  await writeFile(join(out, "release.json"), JSON.stringify(release, null, 2) + "\n");
  return { identity: data.identity, release, data };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { identity, release } = await build();
  console.log(`${identity.title} (${identity.id}) static build: ${Object.keys(release.files).length} pinned files from ${Object.keys(release.sources).length} sources`);
}
