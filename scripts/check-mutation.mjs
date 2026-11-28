// StrykerJS の JSON レポート（reports/mutation/mutation.json）を読み、
// 見逃し（Survived + NoCoverage）上限のラチェットで合否を決める。
//
// - Stryker は変異対象が 0 件でも終了コード 0 で終わる（空振り）。そのため、試された
//   ミュータントが 1 件以上あることと、stryker.config.mjs の mutate に書いたファイルが
//   すべてレポートに 1 件以上のミュータント付きで現れることも確かめる。
// - Ignored（// Stryker disable で除外した等価ミュータント）は見逃しにも分母にも数えない。
// - Timeout は検出扱い（Stryker のスコアと同じ）。include の循環検出を消すミュータントは
//   無限に再帰して必ず Timeout になる。
// - 上限は実測値。テストを足して見逃しが減ったら MAX_UNDETECTED も下げる。
import { readFileSync } from "node:fs";

import config from "../stryker.config.mjs";

const REPORT = "reports/mutation/mutation.json";

// 2026-11-28 の実測（導入時）: 生成 180 件（core.ts 105・config.ts 75）、
//   等価として除外 2 件、Killed 133・Timeout 3・Survived 41・NoCoverage 1 → 上限 42
//   全件実行 3 回でミュータントごとの結果まで一致した。42 件のうち 1 件
//   （config.ts の `if (includedConfig)` → `if (true)`）は等価だが、同じ行の
//   `if (false)` は殺せているため、ミューテーター単位の除外コメントでは外せず上限に含める。
//   残る 41 件はテストの穴なので余裕は持たせない。新しい等価ミュータントが出たら、
//   上限を上げずに除外コメントで扱う（同じ行の殺せるミュータントまで消えないか、
//   Ignored の件数で確かめる）。
const MAX_UNDETECTED = 42;

function countStatuses(files) {
  const counts = {};
  const mutants = Object.values(files).flatMap((file) => file.mutants);
  for (const { status } of mutants) {
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function missingTargets(files) {
  return config.mutate.filter((file) => !(files[file]?.mutants.length > 0));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const { files } = JSON.parse(readFileSync(REPORT, "utf8"));

for (const [file, { mutants }] of Object.entries(files)) {
  console.log(`${file}: ${mutants.length} mutants`);
}

const counts = countStatuses(files);
console.log("status breakdown:", counts);

const missing = missingTargets(files);
if (missing.length > 0) {
  fail(`No mutants were generated for: ${missing.join(", ")}`);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const tested = total - (counts.Ignored ?? 0);
if (tested === 0) {
  fail("No mutants were tested. The mutate pattern may match nothing.");
}

const undetected = (counts.Survived ?? 0) + (counts.NoCoverage ?? 0);
console.log(
  `tested: ${tested}, undetected: ${undetected} (max ${MAX_UNDETECTED})`
);
if (undetected > MAX_UNDETECTED) {
  fail(
    `Undetected mutants increased: ${undetected} > ${MAX_UNDETECTED}. ` +
      "Add tests that kill the new survivors."
  );
}
