// Ongakuka Android (Tauri v3) shell. All UI lives in the WebView; the host
// exposes no commands, no filesystem, no shell and no installer permission.
// Network access to the appview Worker is declared in the client-runtime
// descriptor (app/dist/descriptor.json) and gated by per-origin consent in
// app/src/app.js -- the shell grants nothing implicitly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .setup(|_| Ok(()))
        .run(tauri::generate_context!())
        .expect("ongakuka app failed to start");
}
