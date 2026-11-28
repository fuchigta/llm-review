// 設定ファイル（TOML）の読み込みと include によるマージ。
// CLI のエントリポイント（cli.ts）は import しただけで main() が走るため、
// テストから呼べるようにこのモジュールへ分けている
import * as toml from "@iarna/toml";
import fs from "fs";
import { glob } from "glob";
import path from "path";
import type { LLMReviewConfig } from "./core";

// オブジェクトをディープマージする（配列は結合）
export function deepMerge(target: any, source: any): any {
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
// include パターンに該当する設定ファイルを読み込み、順にマージする
async function loadIncludedConfigs(
  include: string[] | undefined,
  configDir: string,
  processedPaths: Set<string>
): Promise<Partial<LLMReviewConfig>> {
  let mergedConfig: Partial<LLMReviewConfig> = {};
  if (!include || !Array.isArray(include)) {
    return mergedConfig;
  }

  for (const pattern of include) {
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
  return mergedConfig;
}

// 設定ファイルを再帰的に読み込みマージする (include 対応)
export async function loadAndMergeConfigs(
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
    // Stryker disable next-line StringLiteral: 等価。"" だと Buffer が返るが、toml.parse は Buffer を UTF-8 として読む
    const fileContent = fs.readFileSync(absolutePath, "utf8");
    // TOML をパース (unknown経由でキャスト)
    const currentConfig = toml.parse(
      fileContent
    ) as unknown as LLMReviewConfig & {
      include?: string[];
    };

    // 1. include を先に処理 (再帰)
    let mergedConfig = await loadIncludedConfigs(
      currentConfig.include,
      path.dirname(absolutePath),
      processedPaths
    );

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
