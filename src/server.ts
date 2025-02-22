import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  DidChangeConfigurationNotification,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import path from "path";
import fs from "fs";
import * as toml from "@iarna/toml";
import { CONFIG_NAMESPACE, DEFAULT_CONFIG_FILE_NAME } from "./constants";
import { LLMReviewConfig, review, Severity } from "./core";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// 設定ファイルのキャッシュ
let configCache: any = null;
let configPath: string = DEFAULT_CONFIG_FILE_NAME;

connection.onInitialize((params: InitializeParams) => {
  try {
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
      },
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
});

connection.onInitialized(() => {
  // ファイル変更通知を登録
  connection.client.register(
    DidChangeConfigurationNotification.type,
    undefined
  );
});

connection.onDidChangeWatchedFiles((change) => {
  console.log(change);
  for (const event of change.changes) {
    const fileName = path.basename(event.uri);

    console.log(fileName);

    if (fileName === "llm-review.toml") {
      connection.console.log(`Config file changed: ${event.uri}`);

      // キャッシュを無効化して再読み込み
      configCache = null;
      configPath = event.uri.replace("file://", "");

      // すべての開いているドキュメントを再検証
      documents.all().forEach(validateTextDocument);
    }
  }
});

async function loadConfig(uri: string) {
  if (configCache) {
    return configCache;
  }

  try {
    // URIからファイルパスに変換
    const filePath = uri.replace("file://", "");

    // ファイルの存在確認
    if (!fs.existsSync(filePath)) {
      connection.console.log(`Config file not found: ${filePath}`);
      return {};
    }

    // 設定ファイル読み込み
    const content = fs.readFileSync(filePath, "utf8");
    configCache = toml.parse(content);
    connection.console.log(`Config loaded from: ${filePath}`);

    return configCache;
  } catch (error) {
    connection.console.error(`Error loading config: ${error}`);
    return {};
  }
}

async function validateTextDocument(textDocument: TextDocument) {
  let config = await loadConfig(configPath);

  const text = textDocument.getText();
  const filePath = textDocument.uri.replace("file://", "");

  const llmReviwDiagnostics = await review(
    filePath,
    text,
    config as LLMReviewConfig
  );

  try {
    const diagnostics: Diagnostic[] = llmReviwDiagnostics.map(
      (ld) =>
        ({
          severity: convertSeverity(ld.severity),
          range: {
            start: {
              line: ld.line - 1,
              character: ld.column - 1,
            },
            end: {
              line: ld.line - 1,
              character: 999,
            },
          },
          message: ld.message,
          source: CONFIG_NAMESPACE,
        } satisfies Diagnostic)
    );

    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  } catch (error) {
    console.error(error);
  }
}

documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

documents.listen(connection);
connection.listen();

function convertSeverity(severity: Severity): any {
  switch (severity) {
    case "HINT":
      return DiagnosticSeverity.Hint;
    case "INFO":
      return DiagnosticSeverity.Information;
    case "WARNING":
      return DiagnosticSeverity.Warning;
    case "ERROR":
      return DiagnosticSeverity.Error;
  }
}
