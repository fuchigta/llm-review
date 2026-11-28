import { configDotenv } from "dotenv";
import path from "path";
import { fetch, ProxyAgent } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";
import { InvalidLLMError, LLMReviewConfig, review } from "../src/core";

// LLM クライアントはモックに置き換え、実 API は呼ばない。
// どのクラスが作られたか（created）とコンストラクタに渡された値（fields）、
// withStructuredOutput / invoke に渡された値を記録する
const llm = vi.hoisted(() => {
  const invoke = vi.fn();
  const withStructuredOutput = vi.fn((_schema: unknown, _options: unknown) => ({
    invoke,
  }));
  const created: string[] = [];
  const fields: unknown[] = [];
  // name のクラスを作ると created に name を、fields にコンストラクタの引数を記録する偽の LLM クラス
  function fakeModel(name: string) {
    return class {
      withStructuredOutput = withStructuredOutput;
      constructor(args: unknown) {
        created.push(name);
        fields.push(args);
      }
    };
  }
  return { invoke, withStructuredOutput, created, fields, fakeModel };
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
  llm.fields.length = 0;
  vi.mocked(configDotenv).mockReset();
  // 実行環境の環境変数に結果が左右されないよう、core.ts が読むものはすべて未設定にする
  // （HTTPS_PROXY が設定された環境では、プロキシ設定のミュータントの結果が CI と変わる）
  for (const name of [
    "LLM_PROVIDER",
    "LLM_MODEL",
    "LLM_API_KEY",
    "LLM_API_VERSION",
    "LLM_API_BASE_PATH",
    "HTTPS_PROXY",
  ]) {
    vi.stubEnv(name, undefined);
  }
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

describe("review: LLM client settings", () => {
  it("passes the configured model and LLM_API_KEY to ChatOpenAI", async () => {
    vi.stubEnv("LLM_MODEL", "gpt-4.1-mini");
    vi.stubEnv("LLM_API_KEY", "openai-key");
    const config = readmeConfig({ provider: "openai", model: "gpt-4.1" });

    await review("README.md", "text", config, []);

    expect(llm.fields).toEqual([
      { model: "gpt-4.1", apiKey: "openai-key", configuration: {} },
    ]);
  });

  it("falls back to LLM_MODEL for ChatOpenAI", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("LLM_MODEL", "gpt-4.1-mini");
    vi.stubEnv("LLM_API_KEY", "openai-key");
    const config = readmeConfig();

    await review("README.md", "text", config, []);

    expect(llm.fields).toEqual([
      { model: "gpt-4.1-mini", apiKey: "openai-key", configuration: {} },
    ]);
  });

  it("passes the configured model, API version and base path to AzureChatOpenAI", async () => {
    vi.stubEnv("LLM_MODEL", "env-deployment");
    vi.stubEnv("LLM_API_KEY", "azure-key");
    vi.stubEnv("LLM_API_VERSION", "2024-10-21");
    vi.stubEnv("LLM_API_BASE_PATH", "https://env.openai.azure.com");
    const config = readmeConfig({
      provider: "azure-openai",
      model: "config-deployment",
      apiVersion: "2025-04-01-preview",
      basePath: "https://config.openai.azure.com",
    });

    await review("README.md", "text", config, []);

    expect(llm.fields).toEqual([
      {
        model: "config-deployment",
        apiKey: "azure-key",
        azureOpenAIApiDeploymentName: "config-deployment",
        azureOpenAIApiKey: "azure-key",
        azureOpenAIApiVersion: "2025-04-01-preview",
        azureOpenAIBasePath: "https://config.openai.azure.com",
        configuration: {},
      },
    ]);
  });

  it("falls back to the environment variables for AzureChatOpenAI", async () => {
    vi.stubEnv("LLM_PROVIDER", "azure-openai");
    vi.stubEnv("LLM_MODEL", "env-deployment");
    vi.stubEnv("LLM_API_KEY", "azure-key");
    vi.stubEnv("LLM_API_VERSION", "2024-10-21");
    vi.stubEnv("LLM_API_BASE_PATH", "https://env.openai.azure.com");
    const config = readmeConfig();

    await review("README.md", "text", config, []);

    expect(llm.fields).toEqual([
      {
        model: "env-deployment",
        apiKey: "azure-key",
        azureOpenAIApiDeploymentName: "env-deployment",
        azureOpenAIApiKey: "azure-key",
        azureOpenAIApiVersion: "2024-10-21",
        azureOpenAIBasePath: "https://env.openai.azure.com",
        configuration: {},
      },
    ]);
  });

  it("passes the configured model and LLM_API_KEY to ChatGoogleGenerativeAI", async () => {
    vi.stubEnv("LLM_MODEL", "gemini-2.5-flash");
    vi.stubEnv("LLM_API_KEY", "google-key");
    const config = readmeConfig({ provider: "google", model: "gemini-2.5-pro" });

    await review("README.md", "text", config, []);

    expect(llm.fields).toEqual([{ model: "gemini-2.5-pro", apiKey: "google-key" }]);
  });

  it("falls back to LLM_MODEL for ChatGoogleGenerativeAI", async () => {
    vi.stubEnv("LLM_PROVIDER", "google");
    vi.stubEnv("LLM_MODEL", "gemini-2.5-flash");
    vi.stubEnv("LLM_API_KEY", "google-key");
    const config = readmeConfig();

    await review("README.md", "text", config, []);

    expect(llm.fields).toEqual([{ model: "gemini-2.5-flash", apiKey: "google-key" }]);
  });
});

describe("review: HTTPS_PROXY", () => {
  it("sends OpenAI and Azure OpenAI requests through HTTPS_PROXY when it is set", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://proxy.example.com:8080");

    await review("README.md", "text", readmeConfig({ provider: "openai" }), []);
    await review(
      "README.md",
      "text",
      readmeConfig({ provider: "azure-openai" }),
      []
    );

    expect(llm.created).toEqual(["ChatOpenAI", "AzureChatOpenAI"]);
    const throughProxy = expect.objectContaining({
      configuration: {
        fetch,
        fetchOptions: { dispatcher: expect.any(ProxyAgent) },
      },
    });
    expect(llm.fields).toEqual([throughProxy, throughProxy]);
  });
});

describe("review: .env", () => {
  it("loads .env before choosing the provider", async () => {
    // .env に LLM_PROVIDER が書かれている場合を、configDotenv が環境変数を設定することで再現する
    vi.mocked(configDotenv).mockImplementation(() => {
      vi.stubEnv("LLM_PROVIDER", "google");
      return { parsed: {} };
    });
    const config = readmeConfig();

    await review("README.md", "text", config, []);

    expect(configDotenv).toHaveBeenCalledTimes(1);
    expect(llm.created).toEqual(["ChatGoogleGenerativeAI"]);
  });
});

describe("review: response schema descriptions", () => {
  // 説明文はスキーマの一部として LLM に送られ、指示として働く
  it("describes the response and each diagnostic field", async () => {
    const config = readmeConfig({ provider: "openai" });

    await review("README.md", "text", config, []);

    const schema = llm.withStructuredOutput.mock.calls[0][0] as z.ZodType;
    const json = z.toJSONSchema(schema) as any;
    expect(json.description).toBe(
      "レビュー実施結果。前回指摘(prevMessages)と同義の指摘は禁止する。"
    );
    const diagnostics = json.properties.diagnostics;
    expect(diagnostics.description).toBe("指摘事項のリスト");
    expect(diagnostics.items.description).toBe("指摘事項");
    const properties = diagnostics.items.properties;
    expect(properties.message.description).toBe("問題の内容");
    expect(properties.severity.description).toBe("問題の重要度");
    expect(properties.line.description).toBe(
      '問題箇所の行番号。入力されたJSONの"line"を指定すること。'
    );
    expect(properties.column.description).toBe(
      "問題箇所の列番号。1を指定すること。"
    );
  });
});
