# app/ — Ongakuka Android (Tauri v3) shell

`network.itonami.ongakuka` の Tauri v3 アプリ。WebView に実 UI を載せる:

- **概要** (`index.html` の初期タブ): `src/ongakuka/view.cljk` の hiccup をビルド時に静的描画した
  `ongakuka-static.html` を iframe で表示。手書きのコピーではない（`scripts/build.mjs`
  が kbb で再描画し、drift したら fail する）。
- **作曲 / 一覧 / 詳細**: appview Worker の XRPC (`POST /xrpc/com.etzhayyim.ongakuka.{compose,
  listTracks,getTrack}`、`GET /health`) を **broker（`src/broker.js`）を介して**叩く実クライアント。
  ページは「何を送りたいか」を渡すだけ（最小限の body。作曲は曲名・歌詞・style prompt のみで、
  個人情報を足さない）。送信は broker が行い、送るたびに broker の信頼ダイアログが
  宛先・操作・データカテゴリを表示して承認を取る。拒否されたら 1 バイトも送らない
  （`app/test/broker.test.mjs` で「deny → 0 リクエスト」「approve → 正確に 1 リクエスト」を
  stub で実測）。生成そのものは murakumo の audio 側にあり、ここには無い。
- **設定**: 接続先は descriptor で宣言された origin（`https://ongakuka.etzhayyim.com`）のみ
  で、画面から変更できない（それ以外への送信は broker が拒否する）。送れる操作の一覧を表示する。

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

## ビルド入力の再現性について（handover）

概要ページの静的描画は `scripts/build.mjs` が kbb（kotoba babashka）で再描画します。
この際の入力は npm / Cargo の依存だけでなく、`~/github/repos/kotoba-lang/{kotoba,
jp-go-digital-design-system}` の手元の checkout（`kotoba` の `bin/kbb`、`lib/kotoba.{text,
html,css}`、`jp-go-dds` の src / resources）です。パスは `KOTOBA_KBB` / `KOTOBA_LIB` /
`KOTOBA_JP_DDS` で差し替えできますが、checkout が無い環境では build が
「static render needs the kotoba checkouts…」で fail します（古い snapshot への
フォールバックはしません）。dirty input が隠れた形で再現性を弱めるため、checkout の
commit（`kotoba` と `jp-go-digital-design-system` の sha）を build log に出す、または
入力を npm lock のように pin することは後段の改善です（本 PR では README への明記で
対処しています）。

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
