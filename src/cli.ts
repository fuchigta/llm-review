#!/usr/bin/env node

import * as toml from "@iarna/toml";
import { program } from "commander";
import fs from "fs";
import path from "path";
import { glob } from "glob";
import { version } from "../package.json";
import { CONFIG_FILE_NAME } from "./constants";
import { LLMReviewConfig, review } from "./core";

// オブジェクトをディープマージする（配列は結合）
function deepMerge(target: any, source: any): any {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      const targetValue = target[key];
      const sourceValue = source[key];

      if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
        // 配列の場合は結合する
        output[key] = targetValue.concat(sourceValue);
      } else if (isObject(sourceValue)) {
        // ソースがオブジェクトの場合
        if (!(key in target) || !isObject(targetValue)) {
          // ターゲットにキーがないか、ターゲットの値がオブジェクトでない場合は、ソースをそのまま代入
          output[key] = sourceValue;
        } else {
          // ターゲットもオブジェクトの場合は再帰的にマージ
          output[key] = deepMerge(targetValue, sourceValue);
        }
      } else {
        // ソースがオブジェクトでも配列でもない場合は、単純に上書き
        output[key] = sourceValue;
      }
    });
  }
  return output;
}

function isObject(item: any): boolean {
  return item && typeof item === "object" && !Array.isArray(item);
}
// 設定ファイルを再帰的に読み込みマージする (include 対応)
async function loadAndMergeConfigs(
  filePath: string,
  processedPaths: Set<string> = new Set()
): Promise<LLMReviewConfig | null> {
  const absolutePath = path.resolve(filePath);

  // 循環参照チェック
  if (processedPaths.has(absolutePath)) {
    console.warn(
      `Circular dependency detected involving ${absolutePath}. Skipping.`
    );
    return null;
  }

  if (!fs.existsSync(absolutePath)) {
    // 初回読み込み時のみファイルが見つからない旨をログ出力
    if (processedPaths.size === 0) {
      console.log(`Config file not found: ${absolutePath}`);
    } else {
    }
    return null;
  }

  processedPaths.add(absolutePath); // 処理中のパスとしてマーク

  try {
    const fileContent = fs.readFileSync(absolutePath, "utf8");
    // TOML をパース (unknown経由でキャスト)
    const currentConfig = toml.parse(
      fileContent
    ) as unknown as LLMReviewConfig & {
      include?: string[];
    };

    let mergedConfig: Partial<LLMReviewConfig> = {}; // マージ結果の一時変数
    const configDir = path.dirname(absolutePath);

    // 1. include を先に処理 (再帰)
    if (currentConfig.include && Array.isArray(currentConfig.include)) {
      for (const pattern of currentConfig.include) {
        // include パターンを解決 (設定ファイルからの相対パス)
        const includePaths = await glob(pattern, {
          cwd: configDir,
          absolute: true,
        });
        for (const includePath of includePaths) {
          // processedPaths のコピーを渡して循環参照チェック
          const includedConfig = await loadAndMergeConfigs(
            includePath,
            new Set(processedPaths)
          );
          if (includedConfig) {
            // include した設定をマージ (後勝ち)
            mergedConfig = deepMerge(mergedConfig, includedConfig);
          }
        }
      }
    }

    // 2. 現在の設定をマージ (include した設定に上書き)
    // include プロパティを除外
    const { include, ...configDataToMerge } = currentConfig;
    mergedConfig = deepMerge(mergedConfig, configDataToMerge);

    // 必須プロパティ(docs)の存在確認
    if (!mergedConfig || typeof mergedConfig.docs === "undefined") {
      console.error(
        `Configuration loaded from ${absolutePath} (and its includes) is missing the required 'docs' section.`
      );
      return null;
    }

    // 型アサーション
    return mergedConfig as LLMReviewConfig;
  } catch (error) {
    console.error(`Error loading or parsing config ${absolutePath}: ${error}`);
    // エラー時も処理中パスから削除
    processedPaths.delete(absolutePath);
    return null;
  }
}

async function main() {
  program
    .name("llm-review")
    .description("LLM を活用した効率的なレビューツール")
    .version(version)
    .option("--config <path>", "Config file path", CONFIG_FILE_NAME)
    .option("--ignore <patterns>", "Glob patterns to ignore (comma-separated)")
    .argument("<patterns...>", "Files or glob patterns to review")
    .parse();

  // 設定ファイルを読み込み・マージ
  const config = await loadAndMergeConfigs(program.opts().config);
  if (!config) {
    console.error("Failed to load configuration. Exiting.");
    process.exit(1);
  }

  const patterns = program.args;
  if (patterns.length === 0) {
    console.error("No files or patterns specified");
    process.exit(1);
  }

  // 無視パターンを処理
  const ignorePatterns = program.opts().ignore
    ? program.opts().ignore.split(",")
    : [];

  let allFiles: string[] = [];

  // 各パターンに対してファイルを取得
  for (const pattern of patterns) {
    try {
      // パターンにワイルドカードが含まれているか確認
      if (
        pattern.includes("*") ||
        pattern.includes("?") ||
        pattern.includes("[")
      ) {
        const files = await glob(pattern, { ignore: ignorePatterns });
        allFiles = allFiles.concat(files);
      } else {
        // ワイルドカードがない場合はファイルとして直接追加
        if (fs.existsSync(pattern) && fs.statSync(pattern).isFile()) {
          allFiles.push(pattern);
        } else {
          console.warn(`Warning: File not found: ${pattern}`);
        }
      }
    } catch (error) {
      console.error(`Error processing pattern ${pattern}:`, error);
    }
  }

  // 重複を除去
  allFiles = [...new Set(allFiles)];

  if (allFiles.length === 0) {
    console.error("No matching files found");
    process.exit(1);
  }

  for (const file of allFiles) {
    try {
      const text = fs.readFileSync(file, { encoding: "utf8" });
      const res = await review(file, text, config);

      if (!res.length) {
        continue;
      }

      for (const ld of res) {
        console.log(
          `${file}:${ld.line}:${ld.column}: ${ld.severity} - ${ld.message}`
        );
      }
    } catch (error) {
      console.error(`Error processing file ${file}:`, error);
    }
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
