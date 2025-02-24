import fs from "fs";
import * as toml from "@iarna/toml";
import { program } from "commander";
import { LLMReviewConfig, review } from "./core";
import { DEFAULT_CONFIG_FILE_NAME } from "./constants";

function loadConfig(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    return toml.parse(fs.readFileSync(filePath, "utf8")) as any;
  } catch (error) {
    console.error(`Error loading config: ${error}`);
    return {};
  }
}

async function main() {
  program.option("--config").argument("<string>");
  program.parse();

  const config = loadConfig(
    program.opts().config || DEFAULT_CONFIG_FILE_NAME
  ) as LLMReviewConfig;

  for (const file of program.args) {
    const text = fs.readFileSync(file, { encoding: "utf8" });

    const res = await review(file, text, config);

    for (const ld of res) {
      console.log(
        `${file}:${ld.line}:${ld.column}: ${ld.severity} - ${ld.message}`
      );
    }
  }
}

main().catch((err) => console.error(err));
