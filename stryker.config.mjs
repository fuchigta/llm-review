// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: "npm",
  // npm の node_modules 構成では @stryker-mutator/vitest-runner が自動で見つかるため、
  // plugins は書かない（pnpm の better-feedly / summary-current-tab とは違う）
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.mts" },
  // 変異対象。scripts/check-mutation.mjs が各ファイルにミュータントがあることを
  // 確かめるので、glob ではなくファイルのパスで書く。
  // - src/cli.ts（メモリファイル・ファイル収集・main）は import すると main() が走るため
  //   単体テストが無く、対象外
  // - src/extension.ts・src/server.ts は VS Code / Language Server の配線が中心で、
  //   node 環境の vitest では動かせないため対象外
  // - src/constants.ts は定数だけで、ミュータントにする意味が薄いため対象外
  mutate: ["src/config.ts", "src/core.ts"],
  reporters: ["clear-text", "progress", "json"],
  coverageAnalysis: "perTest",
  tempDirName: ".stryker-tmp",
};
export default config;
