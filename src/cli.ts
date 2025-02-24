#!/usr/bin/env node

import fs from "fs";
import * as toml from "@iarna/toml";
import { program } from "commander";
import { LLMReviewConfig, review } from "./core";
import { CONFIG_FILE_NAME } from "./constants";
import { version } from "../package.json";

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
    .argument("<files...>", "Files to review")
    .parse();

  const config = loadConfig(program.opts().config) as LLMReviewConfig;
  if (!config) {
    process.exit(1);
  }

  const files = program.args;
  if (files.length === 0) {
    console.error("No files specified");
    process.exit(1);
  }

  for (const file of files) {
    try {
      const text = fs.readFileSync(file, { encoding: "utf8" });
      const res = await review(file, text, config);

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
