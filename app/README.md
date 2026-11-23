# app/ — Ongakuka Android (Tauri v3) shell

`network.itonami.ongakuka` の Tauri v3 アプリ。WebView に実 UI を載せる:

- **概要** (`index.html` の初期タブ): `src/ongakuka/view.cljk` の hiccup をビルド時に静的描画した
  `ongakuka-static.html` を iframe で表示。手書きのコピーではない（`scripts/build.mjs`
  が kbb で再描画し、drift したら fail する）。
- **作曲 / 一覧 / 詳細**: appview Worker の XRPC (`POST /xrpc/com.etzhayyim.ongakuka.{compose,
  listTracks,getTrack}`、`GET /health`) を WebView から叩く実クライアント。生成そのものは
  murakumo の audio 側にあり、ここには無い。
- **設定**: Worker base URL（既定 `https://ongakuka.etzhayyim.com`、https のみ）と
  origin ごとの通信承認（localStorage、既定で deny、設定から取消可能）。

`package.json` の `itonami.runtime` は `restricted-wasm-v1`。descriptor
（`dist/descriptor.json`）も同 profile で、4 つの operation はすべて
`consent: "each-operation"`。社内 broker（`vendor/kotoba-client-runtime.js`）の
`clientRuntimeProblems` 検証を通す。

## 画面インベントリ（390x844 基準）

| 画面 | 状態 | 主要操作 |
|---|---|---|
| 概要 | 静的表示（iframe） | スクロールで説明ページを読む |
| 作曲 | 空フォーム | 曲名・歌詞・style prompt を入力して「生成を依頼」→ trackUri / 502 等の結果を表示。実行前に origin 承認ダイアログ |
| 一覧 | 空 / 読み込中 / 一覧 / エラー | 「一覧を取得」で listTracks を叩き、曲をタップで詳細へ |
| 詳細 | 空 / 読み込中 / 表示 / エラー | projectId を入れて getTrack → stem ごとの `<audio>` + 音量スライダー（mixer）、critic の CLAP スコア・フラグ表示 |
| 設定 | 表示 | base URL 保存（https のみ）、承認済み origin の一覧・取消 |

## ビルド

```bash
export PATH="$HOME/.cargo/bin:$PATH"          # rustc 1.100.0（/opt/homebrew/bin の rustc は android target を持たない）
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=$HOME/Library/Android/sdk
export NDK_HOME=$HOME/Library/Android/sdk/ndk/27.0.12077973
cd ../.. && npm --prefix app test             # 静的ビルド + node --test
cd app && sh scripts/android-apk.sh           # npm ci → build → tauri android init/build --debug --apk --target aarch64
```

`scripts/build.mjs` は `~/github/repos/kotoba-lang/{kotoba,jp-go-digital-design-system}`
の checkout が無いと fail する（`KOTOBA_KBB` / `KOTOBA_LIB` / `KOTOBA_JP_DDS` で差し替え可）。

## ライセンス

| 素材 | ライセンス |
|---|---|
| 静的ページの CSS（`resources/jp_go_dds/dds.css` 由来） | MIT（上流 `digital-go-jp/design-system-example-components-html`、commit `3b34f4c…`） |
| `vendor/kotoba-client-runtime.js` / `kotoba-client-consent.css`（PINS.json で sha 固定） | Apache-2.0（kotoba-lang/kotoba） |
| `src-tauri/icons/` | Tauri テンプレート由来（store 掲載時の正式アイコン差し替えは後段の範囲） |
| 生成物（dist/, src-tauri/gen/, node_modules/, src-tauri/target/） | git 管理しない |

音源・サンプルの無断流用は一切行っていない。生成は murakumo audio 側が
`AGENTS.md` の copyright / consent invariants の下で行う（学習データは
permissive / consent 明示のみ、critic の CLAP cosine > 0.92 で reject 等）。
