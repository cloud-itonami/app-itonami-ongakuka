#!/usr/bin/env node
// Shim for the generated Android build: tauri's RustPlugin buildSrc runs
//   node tauri android android-studio-script
// with this directory (src-tauri) as its working directory, so node resolves
// this file as the `tauri` module. Forward to the real CLI in ../node_modules.
// The app's package.json sets "type": "module", so this file is ESM.
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require(path.join(process.cwd(), "..", "node_modules", "@tauri-apps", "cli", "tauri.js"));
