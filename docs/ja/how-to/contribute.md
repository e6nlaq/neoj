[English](../../how-to/contribute.md) | 日本語

> この文書は日本語版です。英語版の更新が反映されていないことがあるため、内容が異なるときは[英語版](../../how-to/contribute.md)が正です。

# neoj に貢献する

## リポジトリを整える

```bash
bun install
```

`prepare` スクリプトが Lefthook の pre-commit フックを入れます。

## 検査を実行する

```bash
bun test           # unit tests
bun run format     # format the code
bun run lint       # lint with Oxlint
bun run typecheck  # type-check with TypeScript
bun run build      # bundle the CLI into dist/
```

pre-commit フックは、整形、リント、型検査を実行します。プルリクエストを出す前に、`bun test` を通してください。

## コミットメッセージ

コミットは[Conventional Commits](https://www.conventionalcommits.org/)に従います。`docs: restructure the guides` や `feat: add problem metadata` のような形です。

## リリースの手順

リリースは、GitHub Actions の `Release` ワークフロー(`.github/workflows/release.yml`)で手動に作ります。

1. `main` の `package.json` の `version` を上げてマージします。
2. Actionsタブで **Release** ワークフローを開き、実行します(ドライランもできます)。バージョンは `package.json` から読みます。
3. ワークフローはバージョンを検証し、信頼できる公開(trusted publishing、OIDC、保存トークンなし)で `@neoj/cli` をnpmに公開し、Linux、macOS、Windows向けのスタンドアロンバイナリをコンパイルし、バイナリとチェックサムを添えて `v<version>` のタグ付きGitHub Releaseを作ります。

npm の trusted publishing は、npmjs.com でこのリポジトリと `release.yml` ワークフローファイルを対象に設定する必要があり、environment は使いません。ワークフローは明示的な `bun run build` のあとに `npm publish --ignore-scripts` で公開するため、パッケージの `prepare` スクリプト(Lefthook)がCIで動くことはありません。

バイナリは `bun build --compile` で作られ、プロジェクトのテンプレートを埋め込むため、スタンドアロン実行ファイルからでも `neoj init` が動きます。

## 関連文書

- [プラットフォーム](../explanation/platforms.md)は統合の構成を説明します。
