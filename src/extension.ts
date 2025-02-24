import * as vscode from "vscode";
import * as path from "path";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { workspace } from "vscode";
import {
  CONFIG_KEY_CONFIG_FILE_NAME,
  CONFIG_FILE_NAME,
  CONFIG_NAMESPACE,
} from "./constants";

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
  const serverModule = context.asAbsolutePath(path.join("out", "server.js"));

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  const configFilePath = config.get<string>(
    CONFIG_KEY_CONFIG_FILE_NAME,
    CONFIG_FILE_NAME
  );

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "markdown" },
      { scheme: "file", language: "plaintext" },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher(configFilePath),
    },
    initializationOptions: {
      configFilePath,
    },
  };

  client = new LanguageClient(
    CONFIG_NAMESPACE,
    "LLM Review Language Server",
    serverOptions,
    clientOptions,
    true
  );

  client.start().catch((err) => console.error(err));
}

export function deactivate() {
  if (!client) {
    return undefined;
  }

  return client.stop();
}
