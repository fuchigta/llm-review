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
import fs from "fs";
import * as toml from "@iarna/toml";
import { CONFIG_NAMESPACE, CONFIG_FILE_NAME } from "./constants";
import { LLMReviewConfig, review, Severity } from "./core";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// 設定ファイルのキャッシュ
let configCache: any = null;
let configFilePath: string = CONFIG_FILE_NAME;

connection.onInitialize((params: InitializeParams) => {
  try {
    // 初期化オプションから設定ファイルのパスを取得
    if (params.initializationOptions) {
      configFilePath =
        params.initializationOptions.configFilePath || CONFIG_FILE_NAME;
    }

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
  for (const event of change.changes) {
    const filePath = event.uri.replace("file://", "");

    console.log(filePath);

    if (filePath === configFilePath) {
      connection.console.log(`Config file changed: ${filePath}`);

      // キャッシュを無効化して再読み込み
      configCache = null;
      configFilePath = filePath;

      // すべての開いているドキュメントを再検証
      documents.all().forEach(validateTextDocument);
    }
  }
});

async function loadConfig() {
  if (configCache) {
    return configCache;
  }

  try {
    // ファイルの存在確認
    if (!fs.existsSync(configFilePath)) {
      connection.console.log(`Config file not found: ${configFilePath}`);
      return null;
    }

    // 設定ファイル読み込み
    const content = fs.readFileSync(configFilePath, "utf8");
    configCache = toml.parse(content);
    connection.console.log(`Config loaded from: ${configFilePath}`);

    return configCache;
  } catch (error) {
    connection.console.error(`Error loading config: ${error}`);
    return null;
  }
}

async function validateTextDocument(textDocument: TextDocument) {
  let config = await loadConfig();
  if (!config) {
    return;
  }

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

function convertSeverity(severity: Severity): DiagnosticSeverity {
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
