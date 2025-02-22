import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AzureChatOpenAI, ChatOpenAI } from "@langchain/openai";
import Handlebars from "handlebars";
import path from "path";
import z from "zod";
import { configDotenv } from "dotenv";

export interface LLMReviewConfig {
  llm?: {
    provider: "google" | "openai" | "azure-openai";
    model?: string;
    apiKey?: string;
    apiVersion?: string;
    basePath?: string;
  };

  docs: {
    default: {
      prompt: string;
    };
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
                "問題箇所の行番号(1始まり)。空行も1行としてカウントすること。"
              ),
            column: z
              .number()
              .int()
              .describe("問題箇所の列番号(行の中で何文字目に問題があるか)"),
          })
          .describe("指摘事項")
      )
      .describe("指摘事項のリスト"),
  })
  .describe("レビュー実施結果");

export async function review(
  filePath: string,
  fileContent: string,
  config: LLMReviewConfig
) {
  configDotenv();

  let llm: ChatGoogleGenerativeAI | ChatOpenAI | AzureChatOpenAI;

  switch (config.llm?.provider || process.env.LLM_PROVIDER) {
    case "google":
      llm = new ChatGoogleGenerativeAI({
        model: config.llm?.model || process.env.GOOGLE_MODEL,
        apiKey: config.llm?.apiKey || process.env.GOOGLE_API_KEY,
      });
      break;
    case "openai":
      llm = new ChatOpenAI({
        model: config.llm?.model || process.env.OPENAI_MODEL,
        apiKey: config.llm?.apiKey || process.env.OPENAI_API_KEY,
      });
      break;
    case "azure-openai":
      llm = new AzureChatOpenAI({
        model: config.llm?.model || process.env.AZUER_OPENAI_MODEL,
        apiKey: config.llm?.apiKey || process.env.AZUER_OPENAI_API_KEY,
        azureOpenAIApiDeploymentName:
          config.llm?.model || process.env.AZUER_OPENAI_MODEL,
        azureOpenAIApiKey:
          config.llm?.apiKey || process.env.AZUER_OPENAI_API_KEY,
        azureOpenAIApiVersion:
          config.llm?.apiVersion || process.env.AZUER_OPENAI_API_VERSION,
        azureOpenAIBasePath:
          config.llm?.basePath || process.env.AZUER_OPENAI_API_BASE_PATH,
      });
      break;
    default:
      throw new InvalidLLMError("unknown provider");
  }

  const fileName = path.basename(filePath);

  const docConfig = config.docs[fileName];
  if (!docConfig) {
    return [];
  }

  const promptTemplate = Handlebars.compile(
    docConfig.prompt || config.docs.default.prompt
  );

  try {
    const res = await llm
      .withStructuredOutput(LLMReviewResponseSchema, {
        strict: true,
      })
      .invoke([
        ["system", promptTemplate(docConfig)],
        ["user", fileContent],
      ]);

    return res.diagnostics;
  } catch (err) {
    console.error(err);
    return [];
  }
}
