#!/usr/bin/env node

import * as toml from "@iarna/toml";
import { program } from "commander";
import fs from "fs";
import { glob } from "glob";
import { version } from "../package.json";
import { CONFIG_FILE_NAME } from "./constants";
import { LLMReviewConfig, review } from "./core";

function loadConfig(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`Config file not found: ${filePath}`);
      return null;
    }

    return toml.parse(fs.readFileSync(filePath, "utf8")) as any;
  } catch (error) {
    console.error(`Error loading config: ${error}`);
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

  const config = loadConfig(program.opts().config) as LLMReviewConfig;
  if (!config) {
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
