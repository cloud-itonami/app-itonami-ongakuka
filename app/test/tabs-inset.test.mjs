// 回帰: タブバーが画面下端のジェスチャ帯に重なると、タップが OS の
// gesture monitor に消費され、タブ切替がアプリに届かない
// (env(safe-area-inset-bottom) はジェスチャナビ端末で 0px を返す)。
// 起動直後の同期 I/O ではなく「タブのタップ到達」が前提条件なので、
// ここでは「タブバーに最小 inset がコードで保証されている」を固定する。
// (dist/style.css は build が src をそのまま copy するので、src の
//  assert で足りる。build() をここで呼ぶと build.test.mjs と並行実行で
//  dist を奪い合うため、呼ばない。)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const APP = fileURLToPath(new URL("../", import.meta.url));

// ボタンの中心がジェスチャ帯の外 (帯は実測で 55dp 以下) にあるための最小値。
const MIN_TABS_INSET_PX = 48;

function tabsPaddingBottom(css) {
  const block = css.match(/\.tabs\s*\{[^}]*\}/);
  assert.ok(block, ".tabs rule exists in style.css");
  const m = block[0].match(/padding-bottom:\s*([^;]+);/);
  assert.ok(m, ".tabs declares padding-bottom");
  return m[1].trim();
}

function minInsetPx(decl) {
  // max(env(safe-area-inset-bottom), Npx) の N を取り出す。単なる env() や
  // 数値だけでは、inset が 0px の端末で帯回避が保証されない。
  const m = decl.match(/^max\(\s*env\(safe-area-inset-bottom\)\s*,\s*(\d+(?:\.\d+)?)px\s*\)$/);
  assert.ok(m, `padding-bottom must be max(env(safe-area-inset-bottom), Npx), got: ${decl}`);
  return Number(m[1]);
}

test("タブバーはジェスチャ帯回避の最小 inset を保証する (src)", async () => {
  const css = await readFile(join(APP, "src/style.css"), "utf8");
  const inset = minInsetPx(tabsPaddingBottom(css));
  assert.ok(
    inset >= MIN_TABS_INSET_PX,
    `min tab inset ${inset}px < ${MIN_TABS_INSET_PX}px: tab taps would land in the gesture strip`,
  );
});
