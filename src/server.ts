import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CONFIG_NAMESPACE } from "./constants";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams) => {
  try {
    const result: InitializeResult = {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
      },
    };
    return result;
  } catch (err) {
    console.error(err);
    throw err;
  }
});

async function validateTextDocument(textDocument: TextDocument) {
  const text = textDocument.getText();
  const filePath = textDocument.uri.replace("file://", "");

  // TODO LLMレビューのロジックを実行

  try {
    const diagnostics: Diagnostic[] = [
      {
        severity: DiagnosticSeverity.Warning,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        message: "test",
        source: CONFIG_NAMESPACE,
      },
    ];

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
