import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // テストは test/ に置く。src/ に置くと tsc が out/ に出力し、
    // .vscode-test.mjs（out/test/**/*.test.js）や VSIX の同梱物に混ざるため
    include: ["test/**/*.test.ts"],
    // .stryker-tmp は StrykerJS の作業用コピーで、Stryker が途中で止まると残ることがある
    exclude: [...configDefaults.exclude, ".stryker-tmp/**"],
    // テストは console の出力を spy で確かめるので、テストごとに元へ戻す
    restoreMocks: true,
    unstubEnvs: true,
  },
});
