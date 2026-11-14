import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AzureChatOpenAI, ChatOpenAI } from "@langchain/openai";
import Handlebars from "handlebars";
import path from "path";
import z from "zod";
import { configDotenv } from "dotenv";
import { minimatch } from "minimatch";
// fetch と ProxyAgent は同じ undici から取る（バージョン混在の警告を避けるため）
import { fetch, ProxyAgent } from "undici";

export interface LLMReviewConfig {
  // Optional list of glob patterns for including other config files
  include?: string[];

  llm?: {
    provider: "google" | "openai" | "azure-openai";
    model?: string;
    apiVersion?: string;
    basePath?: string;
  };

  docs: {
    default: {
      prompt: string;
    };
    // フォルダパターンごとのデフォルトプロンプト設定を追加
    folderDefaults?: Array<{
      pattern: string; // グロブパターン (例: "src/components/**/*.ts")
      prompt: string;
    }>;
  } & {
    [name: string]: {
      [key: string]: any;
    };
  };
}

export class InvalidLLMError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// 診断の重要度
const SeveritySchema = z.enum([
  "ERROR", // エラー: コード品質に重大な問題がある
  "WARNING", // 警告: 潜在的な問題や改善の余地がある
  "INFO", // 情報: 通知のみで対応は任意
  "HINT", // ヒント: 推奨される改善点
]);

export type Severity = z.infer<typeof SeveritySchema>;

function matchGlob(filePath: string, pattern: string): boolean {
  return (
    minimatch(filePath, pattern) ||
    minimatch(path.relative(".", filePath), pattern)
  );
}

const LLMReviewResponseSchema = z
  .object({
    diagnostics: z
      .array(
        z
          .object({
            message: z.string().describe("問題の内容"),
            severity: SeveritySchema.describe("問題の重要度"),
            line: z
              .number()
              .int()
              .describe(
                '問題箇所の行番号。入力されたJSONの"line"を指定すること。'
              ),
            column: z
              .number()
              .int()
              .describe("問題箇所の列番号。1を指定すること。"),
          })
          .describe("指摘事項")
      )
      .describe("指摘事項のリスト"),
  })
  .describe("レビュー実施結果。前回指摘(prevMessages)と同義の指摘は禁止する。");

type LLM = ChatGoogleGenerativeAI | ChatOpenAI | AzureChatOpenAI;

// HTTPS_PROXY が設定されていれば、OpenAI SDK にプロキシ経由の fetch 設定を渡す。
// 現行の openai SDK は httpAgent を参照しないため、undici の dispatcher で指定する。
// 未設定時は何も渡さず、SDK 既定の fetch で直結する（NO_PROXY は未対応）
function createProxyConfiguration() {
  const proxy = process.env.HTTPS_PROXY;
  if (!proxy) {
    return {};
  }
  return {
    // undici 本体の型と @types/node 同梱の undici-types の版がずれているため型だけ合わせる
    fetch: fetch as unknown as typeof globalThis.fetch,
    fetchOptions: { dispatcher: new ProxyAgent(proxy) },
  };
}

function createGoogleLLM(config: LLMReviewConfig): LLM {
  return new ChatGoogleGenerativeAI({
    // 現行の型定義は model: string を要求するが、未設定時の扱いは従来どおり
    // ライブラリ側に任せる（undefined のままコンストラクタへ渡す）ため、型だけ合わせる
    model: (config.llm?.model || process.env.LLM_MODEL) as string,
    apiKey: process.env.LLM_API_KEY,
  });
}

function createOpenAILLM(config: LLMReviewConfig): LLM {
  return new ChatOpenAI({
    model: config.llm?.model || process.env.LLM_MODEL,
    apiKey: process.env.LLM_API_KEY,
    configuration: createProxyConfiguration(),
  });
}

function createAzureOpenAILLM(config: LLMReviewConfig): LLM {
  return new AzureChatOpenAI({
    model: config.llm?.model || process.env.LLM_MODEL,
    apiKey: process.env.LLM_API_KEY,
    azureOpenAIApiDeploymentName: config.llm?.model || process.env.LLM_MODEL,
    azureOpenAIApiKey: process.env.LLM_API_KEY,
    azureOpenAIApiVersion:
      config.llm?.apiVersion || process.env.LLM_API_VERSION,
    azureOpenAIBasePath: config.llm?.basePath || process.env.LLM_API_BASE_PATH,
    configuration: createProxyConfiguration(),
  });
}

// 設定 (または環境変数 LLM_PROVIDER) に応じた LLM クライアントを作成
function createLLM(config: LLMReviewConfig): LLM {
  switch (config.llm?.provider || process.env.LLM_PROVIDER) {
    case "google":
      return createGoogleLLM(config);
    case "openai":
      return createOpenAILLM(config);
    case "azure-openai":
      return createAzureOpenAILLM(config);
    default:
      throw new InvalidLLMError("unknown provider");
  }
}

export async function review(
  filePath: string,
  fileContent: string,
  config: LLMReviewConfig,
  diagnostics: string[] // diagnosticsをmessageのリストに変更
) {
  configDotenv();

  const llm = createLLM(config);

  const fileName = path.basename(filePath);
  const target = config.docs[fileName];

  const matched = config.docs.folderDefaults?.find((folderDefault) =>
    matchGlob(filePath, folderDefault.pattern)
  );

  if (!matched && !target) {
    return [];
  }

  const systemPromptTemplate = Handlebars.compile(
    target?.prompt || matched?.prompt || config.docs.default.prompt
  );

  const userPrompt = JSON.stringify({
    input: fileContent
      .split(/\r?\n/g)
      .map((line, i) => ({ line: i + 1, content: line })),
    prevMessages: diagnostics, // diagnosticsをそのまま渡す
  });

  try {
    const res = await llm
      .withStructuredOutput(LLMReviewResponseSchema, {
        strict: true,
      })
      .invoke([
        ["system", systemPromptTemplate(target || {})],
        ["user", userPrompt],
      ]);

    return res.diagnostics.map((diagnostic) => ({ ...diagnostic, column: 1 }));
  } catch (err) {
    console.error(err);
    return [];
  }
}
