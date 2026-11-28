import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deepMerge, loadAndMergeConfigs } from "../src/config";

describe("deepMerge", () => {
  it("merges nested objects recursively", () => {
    const target = { llm: { provider: "openai", model: "gpt" } };
    const source = { llm: { model: "gpt-mini" } };

    expect(deepMerge(target, source)).toEqual({
      llm: { provider: "openai", model: "gpt-mini" },
    });
  });

  it("concatenates arrays", () => {
    const target = { include: ["a.toml"] };
    const source = { include: ["b.toml", "c.toml"] };

    expect(deepMerge(target, source)).toEqual({
      include: ["a.toml", "b.toml", "c.toml"],
    });
  });

  it("overwrites scalar values with the source value", () => {
    expect(deepMerge({ a: 1, b: "x" }, { b: "y" })).toEqual({ a: 1, b: "y" });
  });

  it("adds a source object whose key is missing in the target", () => {
    expect(deepMerge({ a: 1 }, { b: { c: 2 } })).toEqual({ a: 1, b: { c: 2 } });
  });

  it("replaces a non-object target value with a source object", () => {
    expect(deepMerge({ a: "text" }, { a: { c: 2 } })).toEqual({ a: { c: 2 } });
  });

  it("replaces an array target value with a source object", () => {
    expect(deepMerge({ a: [1] }, { a: { c: 2 } })).toEqual({ a: { c: 2 } });
  });

  it("replaces an object target value with a source array", () => {
    expect(deepMerge({ a: { c: 2 } }, { a: [1] })).toEqual({ a: [1] });
  });

  it("returns a copy of the target when the source is not an object", () => {
    expect(deepMerge({ a: 1 }, null)).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, ["b"])).toEqual({ a: 1 });
  });

  it("ignores the source when the target is not an object", () => {
    expect(deepMerge(undefined, { a: 1 })).toEqual({});
    expect(deepMerge(["x"], { a: 1 })).toEqual({ 0: "x" });
  });

  it("does not modify its arguments", () => {
    const target = { llm: { model: "a" }, list: [1] };
    const source = { llm: { model: "b" }, list: [2] };

    deepMerge(target, source);

    expect(target).toEqual({ llm: { model: "a" }, list: [1] });
    expect(source).toEqual({ llm: { model: "b" }, list: [2] });
  });
});

describe("loadAndMergeConfigs", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-review-config-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeToml(name: string, content: string): string {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  it("loads a single config file", async () => {
    const configPath = writeToml(
      "llm-review.toml",
      `
[llm]
provider = "openai"

[docs.default]
prompt = "default prompt"
`
    );

    expect(await loadAndMergeConfigs(configPath)).toEqual({
      llm: { provider: "openai" },
      docs: { default: { prompt: "default prompt" } },
    });
  });

  it("returns null and logs when the file does not exist", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const missing = path.join(dir, "missing.toml");

    expect(await loadAndMergeConfigs(missing)).toBeNull();
    expect(log).toHaveBeenCalledWith(`Config file not found: ${missing}`);
  });

  it("resolves a relative path from the current directory", async () => {
    writeToml("llm-review.toml", '[docs.default]\nprompt = "p"\n');
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    expect(await loadAndMergeConfigs("llm-review.toml")).toEqual({
      docs: { default: { prompt: "p" } },
    });
  });

  it("returns null when the docs section is missing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const configPath = writeToml(
      "llm-review.toml",
      '[llm]\nprovider = "openai"\n'
    );

    expect(await loadAndMergeConfigs(configPath)).toBeNull();
    expect(error).toHaveBeenCalledWith(
      `Configuration loaded from ${configPath} (and its includes) is missing the required 'docs' section.`
    );
  });

  it("returns null when the file is not valid TOML", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const configPath = writeToml("llm-review.toml", "docs = [");

    expect(await loadAndMergeConfigs(configPath)).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(`Error loading or parsing config ${configPath}:`)
    );
  });

  it("merges included files relative to the config file", async () => {
    writeToml(
      "config.d/default.toml",
      '[docs.default]\nprompt = "included default"\n'
    );
    writeToml(
      "config.d/readme.toml",
      '[docs."README.md"]\nprompt = "readme prompt"\n'
    );
    const configPath = writeToml(
      "llm-review.toml",
      'include = ["./config.d/*.toml"]\n'
    );

    expect(await loadAndMergeConfigs(configPath)).toEqual({
      docs: {
        default: { prompt: "included default" },
        "README.md": { prompt: "readme prompt" },
      },
    });
  });

  it("lets the including file override included values", async () => {
    writeToml(
      "base.toml",
      `
[llm]
provider = "google"
model = "gemini"

[docs.default]
prompt = "base prompt"
`
    );
    const configPath = writeToml(
      "llm-review.toml",
      `
include = ["base.toml"]

[llm]
provider = "openai"
`
    );

    expect(await loadAndMergeConfigs(configPath)).toEqual({
      llm: { provider: "openai", model: "gemini" },
      docs: { default: { prompt: "base prompt" } },
    });
  });

  it("merges includes in order, so later includes win", async () => {
    writeToml("first.toml", '[docs.default]\nprompt = "first"\n');
    writeToml("second.toml", '[docs.default]\nprompt = "second"\n');
    const configPath = writeToml(
      "llm-review.toml",
      'include = ["first.toml", "second.toml"]\n'
    );

    expect(await loadAndMergeConfigs(configPath)).toEqual({
      docs: { default: { prompt: "second" } },
    });
  });

  it("concatenates folderDefaults from several includes", async () => {
    writeToml(
      "react.toml",
      `
[docs.default]
prompt = "p"

[[docs.folderDefaults]]
pattern = "src/**/*.tsx"
prompt = "react"
`
    );
    writeToml(
      "typescript.toml",
      `
[docs.default]
prompt = "p"

[[docs.folderDefaults]]
pattern = "src/**/*.ts"
prompt = "typescript"
`
    );
    const configPath = writeToml(
      "llm-review.toml",
      'include = ["react.toml", "typescript.toml"]\n'
    );

    const config = await loadAndMergeConfigs(configPath);

    expect(config?.docs.folderDefaults).toEqual([
      { pattern: "src/**/*.tsx", prompt: "react" },
      { pattern: "src/**/*.ts", prompt: "typescript" },
    ]);
  });

  it("loads nested includes", async () => {
    writeToml("nested/leaf.toml", '[docs.default]\nprompt = "leaf"\n');
    writeToml(
      "nested/middle.toml",
      'include = ["leaf.toml"]\n\n[llm]\nprovider = "openai"\n'
    );
    const configPath = writeToml(
      "llm-review.toml",
      'include = ["nested/middle.toml"]\n'
    );

    expect(await loadAndMergeConfigs(configPath)).toEqual({
      llm: { provider: "openai" },
      docs: { default: { prompt: "leaf" } },
    });
  });

  it("does not keep the include key in the result", async () => {
    writeToml("base.toml", '[docs.default]\nprompt = "p"\n');
    const configPath = writeToml(
      "llm-review.toml",
      'include = ["base.toml"]\n'
    );

    const config = await loadAndMergeConfigs(configPath);

    expect(config).not.toHaveProperty("include");
  });

  it("skips an include pattern that matches nothing", async () => {
    const configPath = writeToml(
      "llm-review.toml",
      'include = ["missing/*.toml"]\n\n[docs.default]\nprompt = "p"\n'
    );

    expect(await loadAndMergeConfigs(configPath)).toEqual({
      docs: { default: { prompt: "p" } },
    });
  });

  it("stops at a circular include and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const aPath = writeToml(
      "a.toml",
      'include = ["b.toml"]\n\n[docs.default]\nprompt = "a"\n'
    );
    writeToml(
      "b.toml",
      'include = ["a.toml"]\n\n[docs."B.md"]\nprompt = "b"\n'
    );

    expect(await loadAndMergeConfigs(aPath)).toEqual({
      docs: { default: { prompt: "a" }, "B.md": { prompt: "b" } },
    });
    expect(warn).toHaveBeenCalledWith(
      `Circular dependency detected involving ${aPath}. Skipping.`
    );
  });
});
