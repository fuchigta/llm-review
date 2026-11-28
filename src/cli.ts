#!/usr/bin/env node

import { program } from "commander";
import fs, { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { glob } from "glob";
import { version } from "../package.json";
import { CONFIG_FILE_NAME } from "./constants";
import { loadAndMergeConfigs } from "./config";
import { LLMReviewConfig, review } from "./core";
import { createHash } from "crypto";

// メモリファイルのパス
const MEMORY_FILE = path.resolve("memory.json");

// ファイルのハッシュを計算
function calculateHash(filePath: string): string {
  const fileContent = fs.readFileSync(filePath, "utf8");
  return createHash("sha256").update(fileContent).digest("hex");
}

// メモリデータ (ファイルごとのハッシュと指摘メッセージ)
type Memory = Record<
  string,
  { hash: string; diagnostics: Record<string, Set<string>> }
>;

// メモリデータの読み込み
function loadMemory(): Memory {
  if (existsSync(MEMORY_FILE)) {
    try {
      const rawData = JSON.parse(readFileSync(MEMORY_FILE, "utf8"));
      const memory: Memory = {};
      for (const file in rawData) {
        memory[file] = {
          hash: rawData[file].hash,
          diagnostics: Object.fromEntries(
            Object.entries(rawData[file].diagnostics).map(([key, messages]) => [
              key,
              new Set(messages as string[]), // 型を明示的にキャスト
            ])
          ),
        };
      }
      return memory;
    } catch (error) {
      console.error("Failed to load memory file:", error);
    }
  }
  return {};
}

// メモリデータの保存
function saveMemory(memory: Memory) {
  try {
    const rawData: Record<
      string,
      { hash: string; diagnostics: Record<string, string[]> }
    > = {};
    for (const file in memory) {
      rawData[file] = {
        hash: memory[file].hash,
        diagnostics: Object.fromEntries(
          Object.entries(memory[file].diagnostics).map(([key, messages]) => [
            key,
            Array.from(messages),
          ])
        ),
      };
    }
    writeFileSync(MEMORY_FILE, JSON.stringify(rawData, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save memory file:", error);
  }
}


// パターンにワイルドカードが含まれているか確認
function isGlobPattern(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

// 1 つのパターンに該当するファイルを取得
async function resolvePattern(
  pattern: string,
  ignorePatterns: string[]
): Promise<string[]> {
  if (isGlobPattern(pattern)) {
    return glob(pattern, { ignore: ignorePatterns });
  }
  // ワイルドカードがない場合はファイルとして直接追加
  if (fs.existsSync(pattern) && fs.statSync(pattern).isFile()) {
    return [pattern];
  }
  console.warn(`Warning: File not found: ${pattern}`);
  return [];
}

// 各パターンに対してファイルを取得し、重複を除去して返す
async function collectFiles(
  patterns: string[],
  ignorePatterns: string[]
): Promise<string[]> {
  let allFiles: string[] = [];

  for (const pattern of patterns) {
    try {
      allFiles = allFiles.concat(await resolvePattern(pattern, ignorePatterns));
    } catch (error) {
      console.error(`Error processing pattern ${pattern}:`, error);
    }
  }

  // 重複を除去
  return [...new Set(allFiles)];
}

// 1 ファイルをレビューし、新しい指摘をメモリに追加して出力
async function reviewFile(
  file: string,
  config: LLMReviewConfig,
  memory: Memory
) {
  try {
    const currentHash = calculateHash(file);

    // ハッシュが異なる場合、diagnosticsをクリア
    if (memory[file]?.hash !== currentHash) {
      memory[file] = { hash: currentHash, diagnostics: {} };
    }

    const text = fs.readFileSync(file, { encoding: "utf8" });
    const res = await review(
      file,
      text,
      config,
      Object.values(memory[file].diagnostics).flatMap((set) =>
        Array.from(set)
      )
    );

    if (!res.length) {
      return;
    }

    // メモリに新しい指摘を追加
    for (const ld of res) {
      const key = `${ld.line}:${ld.column}`;
      memory[file].diagnostics[key] =
        memory[file].diagnostics[key] || new Set();
      memory[file].diagnostics[key].add(ld.message);
      console.log(
        `${file}:${ld.line}:${ld.column}: ${ld.severity} - ${ld.message}`
      );
    }
  } catch (error) {
    console.error(`Error processing file ${file}:`, error);
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

  const allFiles = await collectFiles(patterns, ignorePatterns);

  if (allFiles.length === 0) {
    console.error("No matching files found");
    process.exit(1);
  }

  // メモリデータの読み込み
  const memory = loadMemory();

  for (const file of allFiles) {
    await reviewFile(file, config, memory);
  }

  // メモリデータを保存
  saveMemory(memory);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
