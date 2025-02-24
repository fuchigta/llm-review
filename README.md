# llm-review - LLM を活用した効率的なレビューツール

LLM を利用してプレーンテキストに対するレビューができるツールです。

## 特徴

テキストで記述されたレビュー観点をシステムプロンプトとして、入力された文書のレビューを実施できます。

- 見出し構造や論理展開、文書の目的と内容との矛盾などの文脈依存な内容を、 LLM を活用することでレビューできます。
- textlint のような表記ゆれ、句読点の数、一文の長さなどを検証してくれる厳密なリンターと併用することで、文書の読みやすさを向上できます。

## 機能

1. CLI
   - コマンドラインから指定したテキストに対してレビューを実行できます。
2. Visual Studio Code 拡張機能
   - リアルタイムで表示中のテキストに対してレビューを実行できます。

## 設定方法

設定ファイル「llm-review.toml」は TOML 形式になっています。

設定例は以下のとおりです。

```toml
[llm]
provider="google"
model="gemini-2.0-flash"

[docs]
default.prompt="""
入力された文書を厳格にレビューし、指摘事項を`diagnostics`に出力してください。

# レビュー観点

以下の観点に沿って厳格にレビューしてください。

1. 文書のタイトルおよび目的に沿った内容になっているか、不足している内容や冗長な内容はないか
2. 全体像が把握しやすい見出し階層となっているか
3. 読者に伝わりやすい論理展開になっているか
4. 読者に合わせた適切な用語を利用しているか
5. 読者の誤解を招くような曖昧な表現がないか

# 文書のメタデータ

## 目的

{{purpose}}

## 想定読者

{{target}}

## タイトル

{{title}}
"""

[docs."README.md"]

title="llm-review - LLM を活用した効率的なレビューツール"

purpose="""
LLMによるレビューツール「llm-review」について以下の内容を伝えたい。

- 特徴
- 機能
- 設定方法
- 使い方
- 問い合わせ方法
"""

target="""
「llm-review」の使い方を知りたいソフトウェア開発者

- Githubやnpmコマンドの使い方、環境変数の設定方法は知っている
"""
```

設定可能なセクションと設定値について説明します。

### 1. `[llm]`セクション

LLM に関する設定です。

- 本セクションの設定値は環境変数として記載できます。
  - API キーについては秘匿性の高い情報であるため、環境変数による設定のみを許容しています。
  - `.env`ファイルが存在する場合、自動的に読み込みます。
- LLM プロバイダごとの API キーの取得手順等は、プロバイダの公式ドキュメントを参照してください。

利用可能な設定値は以下の通りです。

- `provider`
  - 必須設定です。設定ファイル内、または環境変数「`LLM_PROVIDER`」で指定してください。
  - "google"、"openai"、"azure-openai"のいずれかを指定します。
- `model`
  - 必須設定です。設定ファイル内、または環境変数「`LLM_MODEL`」で指定してください。
  - `provider`で指定した LLM で利用可能なモデルを指定してください。
- `apiVersion`
  - "azure-openai"では必須設定です。設定ファイル内、または環境変数「`LLM_API_VERSION`」で指定してください。
  - "azure-openai" の`model`で指定したモデルで利用可能な API バージョンを指定してください。
- `basePath`
  - "azure-openai"では必須設定です。設定ファイル内、または環境変数「`LLM_API_BASE_PATH`」で指定してください。
  - "https://<ドメイン>/openai/deployments"のように指定してください。

API キーについては以下の通りです。

- 環境変数「`LLM_API_KEY`」
  - 必須設定です
  - `provider`で指定した LLM で利用可能な API キーを指定してください

#### 設定例

Google の gemini-2.0-flash をモデルとして利用する設定です。

llm-review.toml に記述する場合：

```toml
[llm]
provider="google"
model="gemini-2.0-flash"
```

.env に記述する場合：

```env
LLM_PROVIDER="google"
LLM_MODEL="gemini-2.0-flash"
LLM_API_KEY=<APIキー>
```

### 2. `[docs]`セクション

ドキュメント全体の設定です。利用可能な設定値は以下の通りです。

- `default.prompt`
  - 必須設定です
  - レビューのシステムプロンプトです。`{{キーワード}}`形式で各ドキュメントの固有の設定を埋め込みできます。

#### 設定例

purpose、target、title は各ドキュメント固有の設定が埋め込まれます。

```toml
[docs]
default.prompt="""
入力された文書を厳格にレビューし、指摘事項を`diagnostics`に出力してください。

# レビュー観点

以下の観点に沿って厳格にレビューしてください。

1. 文書のタイトルおよび目的に沿った内容になっているか、不足している内容や冗長な内容はないか
2. 全体像が把握しやすい見出し階層となっているか
3. 読者に伝わりやすい論理展開になっているか
4. 読者に合わせた適切な用語を利用しているか
5. 読者の誤解を招くような曖昧な表現がないか

# 文書のメタデータ

## 目的

{{purpose}}

## 想定読者

{{target}}

## タイトル

{{title}}
"""
```

### 3. `[docs."<ドキュメント名>"]`セクション

レビュー対象の各ドキュメント固有の設定です。`default.prompt`に埋め込む任意の設定値を定義できます。

#### 設定例

`default.prompt`で定義した purpose、target、title に"README.md"固有の設定を埋め込みます。

```toml
[docs."README.md"]

title="llm-review - LLM を活用した効率的なレビューツール"

purpose="""
LLMによるレビューツール「llm-review」について以下の内容を伝えたい。

- 特徴
- 機能
- 設定方法
- 使い方
- 問い合わせ方法
"""

target="""
「llm-review」の使い方を知りたいソフトウェア開発者

- Githubやnpmコマンドの使い方、環境変数の設定方法は知っている
"""
```

## 使い方

### CLI

本リポジトリを npm パッケージとしてインストールして利用してください。

```sh
# 0.0.2をバージョン指定でインストールする場合
npm --save-dev install github:fuchigta/llm-review#0.0.2

# 最新版をインストールする場合
npm --save-dev install github:fuchigta/llm-review

# CLIを実行(README.mdをレビューする場合)
npx llm-review README.md
```

### Visual Studio Code 拡張機能

[Release ページ](https://github.com/fuchigta/llm-review/releases)から最新版の vsix をダウンロードして以下の通りインストールしてください。

```sh
# v0.0.2をインストールする場合(最新版のバージョンに合わせる)
code --install-extension .\llm-review-0.0.2.vsix
```

## 問い合わせ方法

Github リポジトリのイシューを登録してください。

[イシューを登録](https://github.com/fuchigta/llm-review/issues/new/choose)
