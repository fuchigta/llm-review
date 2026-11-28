import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidLLMError, LLMReviewConfig, review } from "../src/core";

// LLM クライアントはモックに置き換え、実 API は呼ばない。
// どのクラスが作られたかと、withStructuredOutput / invoke に渡された値を記録する
const llm = vi.hoisted(() => {
  const invoke = vi.fn();
  const withStructuredOutput = vi.fn((_schema: unknown, _options: unknown) => ({
    invoke,
  }));
  const created: string[] = [];
  // name のクラスを作ると created に name を記録する偽の LLM クラス
  function fakeModel(name: string) {
    return class {
      withStructuredOutput = withStructuredOutput;
      constructor() {
        created.push(name);
      }
    };
  }
  return { invoke, withStructuredOutput, created, fakeModel };
});

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: llm.fakeModel("ChatOpenAI"),
  AzureChatOpenAI: llm.fakeModel("AzureChatOpenAI"),
}));

vi.mock("@langchain/google-genai", () => ({
  ChatGoogleGenerativeAI: llm.fakeModel("ChatGoogleGenerativeAI"),
}));

// 手元の .env を読まないようにする
vi.mock("dotenv", () => ({ configDotenv: vi.fn() }));

beforeEach(() => {
  llm.invoke.mockReset();
  llm.invoke.mockResolvedValue({ diagnostics: [] });
  llm.withStructuredOutput.mockClear();
  llm.created.length = 0;
  vi.stubEnv("LLM_PROVIDER", undefined);
});

function systemPrompt(): string {
  const messages = llm.invoke.mock.calls[0][0];
  expect(messages[0][0]).toBe("system");
  return messages[0][1];
}

function userPrompt(): unknown {
  const messages = llm.invoke.mock.calls[0][0];
  expect(messages[1][0]).toBe("user");
  return JSON.parse(messages[1][1]);
}

// README.md に docs のエントリがある設定。プロンプト選択ではなく、
// プロバイダの選択やリクエスト・レスポンスを確かめるテストで使う
function readmeConfig(llmConfig?: LLMReviewConfig["llm"]): LLMReviewConfig {
  return {
    llm: llmConfig,
    docs: { default: { prompt: "p" }, "README.md": {} },
  };
}

describe("review: LLM provider", () => {
  it("uses ChatOpenAI for the openai provider", async () => {
    const config = readmeConfig({ provider: "openai" });

    await review("README.md", "text", config, []);

    expect(llm.created).toEqual(["ChatOpenAI"]);
  });

  it("uses AzureChatOpenAI for the azure-openai provider", async () => {
    const config = readmeConfig({ provider: "azure-openai" });

    await review("README.md", "text", config, []);

    expect(llm.created).toEqual(["AzureChatOpenAI"]);
  });

  it("uses ChatGoogleGenerativeAI for the google provider", async () => {
    const config = readmeConfig({ provider: "google" });

    await review("README.md", "text", config, []);

    expect(llm.created).toEqual(["ChatGoogleGenerativeAI"]);
  });

  it("falls back to the LLM_PROVIDER environment variable", async () => {
    vi.stubEnv("LLM_PROVIDER", "google");
    const config = readmeConfig();

    await review("README.md", "text", config, []);

    expect(llm.created).toEqual(["ChatGoogleGenerativeAI"]);
  });

  it("prefers the configured provider over LLM_PROVIDER", async () => {
    vi.stubEnv("LLM_PROVIDER", "google");
    const config = readmeConfig({ provider: "openai" });

    await review("README.md", "text", config, []);

    expect(llm.created).toEqual(["ChatOpenAI"]);
  });

  it("throws InvalidLLMError for an unknown provider", async () => {
    const config = readmeConfig();

    const result = review("README.md", "text", config, []);

    await expect(result).rejects.toThrow(InvalidLLMError);
    await expect(result).rejects.toThrow("unknown provider");
  });
});

describe("review: prompt selection", () => {
  it("skips files that have no docs entry and match no folder pattern", async () => {
    const config: LLMReviewConfig = {
      llm: { provider: "openai" },
      docs: {
        default: { prompt: "p" },
        folderDefaults: [{ pattern: "src/**/*.ts", prompt: "ts" }],
      },
    };

    expect(await review("docs/guide.md", "text", config, [])).toEqual([]);
    expect(llm.invoke).not.toHaveBeenCalled();
  });

  it("uses the prompt of the docs entry for the file name", async () => {
    const config: LLMReviewConfig = {
      llm: { provider: "openai" },
      docs: {
        default: { prompt: "default" },
        "README.md": { prompt: "readme" },
      },
    };

    await review("some/dir/README.md", "text", config, []);

    expect(systemPrompt()).toBe("readme");
  });

  it("renders the prompt with the values of the docs entry", async () => {
    const config: LLMReviewConfig = {
      llm: { provider: "openai" },
      docs: {
        default: { prompt: "default" },
        "README.md": {
          prompt: "Review {{title}} for {{target}}",
          title: "the README",
          target: "new users",
        },
      },
    };

    await review("README.md", "text", config, []);

    expect(systemPrompt()).toBe("Review the README for new users");
  });

  it("uses the default prompt for a docs entry without a prompt", async () => {
    const config: LLMReviewConfig = {
      llm: { provider: "openai" },
      docs: {
        default: { prompt: "Default review of {{title}}" },
        "README.md": { title: "the README" },
      },
    };

    await review("README.md", "text", config, []);

    expect(systemPrompt()).toBe("Default review of the README");
  });

  it("uses the folder prompt for a docs entry without a prompt when a folder pattern matches", async () => {
    const config: LLMReviewConfig = {
      llm: { provider: "openai" },
      docs: {
        default: { prompt: "default" },
        folderDefaults: [{ pattern: "docs/*.md", prompt: "folder {{title}}" }],
        "guide.md": { title: "guide" },
      },
    };

    await review("docs/guide.md", "text", config, []);

    expect(systemPrompt()).toBe("folder guide");
  });

  it("prefers the prompt of the docs entry over a matching folder pattern", async () => {
    const config: LLMReviewConfig = {
      llm: { provider: "openai" },
      docs: {
        default: { prompt: "default" },
        folderDefaults: [{ pattern: "docs/*.md", prompt: "folder" }],
        "guide.md": { prompt: "file" },
      },
    };

    await review("docs/guide.md", "text", config, []);

    expect(systemPrompt()).toBe("file");
  });

  it("uses the prompt of a matching folder pattern without template values", async () => {
    const config: LLMReviewConfig = {
      llm: { provider: "openai" },
      docs: {
        default: { prompt: "default" },
        folderDefaults: [
          { pattern: "src/**/*.ts", prompt: "ts {{title}}" },
          { pattern: "docs/*.md", prompt: "markdown {{title}}" },
        ],
      },
    };

    await review("docs/guide.md", "text", config, []);

    expect(systemPrompt()).toBe("markdown ");
  });

  it("uses the first matching folder pattern", async () => {
    const config: LLMReviewConfig = {
      llm: { provider: "openai" },
      docs: {
        default: { prompt: "default" },
        folderDefaults: [
          { pattern: "docs/**/*.md", prompt: "first" },
          { pattern: "docs/*.md", prompt: "second" },
        ],
      },
    };

    await review("docs/guide.md", "text", config, []);

    expect(systemPrompt()).toBe("first");
  });

  it("matches folder patterns against the path relative to the current directory", async () => {
    const config: LLMReviewConfig = {
      llm: { provider: "openai" },
      docs: {
        default: { prompt: "default" },
        folderDefaults: [{ pattern: "docs/*.md", prompt: "folder" }],
      },
    };

    await review(path.resolve("docs/guide.md"), "text", config, []);

    expect(systemPrompt()).toBe("folder");
  });

  it("matches folder patterns against an absolute path as given", async () => {
    const absolute = path.resolve("docs/guide.md");
    const config: LLMReviewConfig = {
      llm: { provider: "openai" },
      docs: {
        default: { prompt: "default" },
        folderDefaults: [{ pattern: absolute, prompt: "absolute" }],
      },
    };

    await review(absolute, "text", config, []);

    expect(systemPrompt()).toBe("absolute");
  });
});

describe("review: request and response", () => {
  it("sends the numbered lines and the previous messages", async () => {
    const config = readmeConfig({ provider: "openai" });

    await review("README.md", "first\r\nsecond\nthird", config, [
      "already reported",
    ]);

    expect(userPrompt()).toEqual({
      input: [
        { line: 1, content: "first" },
        { line: 2, content: "second" },
        { line: 3, content: "third" },
      ],
      prevMessages: ["already reported"],
    });
  });

  it("requests strict structured output", async () => {
    const config = readmeConfig({ provider: "openai" });

    await review("README.md", "text", config, []);

    expect(llm.withStructuredOutput).toHaveBeenCalledWith(expect.anything(), {
      strict: true,
    });
  });

  it("uses a response schema that accepts the four severities", async () => {
    const config = readmeConfig({ provider: "openai" });

    await review("README.md", "text", config, []);

    const schema = llm.withStructuredOutput.mock.calls[0][0] as unknown as {
      safeParse(value: unknown): { success: boolean };
    };
    for (const severity of ["ERROR", "WARNING", "INFO", "HINT"]) {
      const diagnostic = { message: "m", severity, line: 1, column: 1 };
      expect(schema.safeParse({ diagnostics: [diagnostic] }).success).toBe(
        true
      );
    }
    const invalidDiagnostics = [
      { message: "m", severity: "FATAL", line: 1, column: 1 },
      { message: "m", severity: "ERROR", line: 1.5, column: 1 },
    ];
    for (const diagnostic of invalidDiagnostics) {
      expect(schema.safeParse({ diagnostics: [diagnostic] }).success).toBe(
        false
      );
    }
  });

  it("returns the diagnostics with the column set to 1", async () => {
    llm.invoke.mockResolvedValue({
      diagnostics: [
        { message: "typo", severity: "WARNING", line: 3, column: 7 },
        { message: "unclear", severity: "HINT", line: 5, column: 1 },
      ],
    });
    const config = readmeConfig({ provider: "openai" });

    expect(await review("README.md", "text", config, [])).toEqual([
      { message: "typo", severity: "WARNING", line: 3, column: 1 },
      { message: "unclear", severity: "HINT", line: 5, column: 1 },
    ]);
  });

  it("returns no diagnostics and logs the error when the LLM call fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("rate limited");
    llm.invoke.mockRejectedValue(failure);
    const config = readmeConfig({ provider: "openai" });

    expect(await review("README.md", "text", config, [])).toEqual([]);
    expect(error).toHaveBeenCalledWith(failure);
  });
});
