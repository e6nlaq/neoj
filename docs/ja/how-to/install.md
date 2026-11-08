[English](../../how-to/install.md) | 日本語

> この文書は日本語版です。英語版の更新が反映されていないことがあるため、内容が異なるときは[英語版](../../how-to/install.md)が正です。

# neoj をインストールする

`neoj` は npm に `@neoj/cli` として公開されています。Bun または npm でグローバルにインストールします。

## Bun を使う(推奨)

```bash
bun install -g @neoj/cli
```

## npm を使う

```bash
npm install -g @neoj/cli
```

## ビルド済みバイナリ

未署名のスタンドアロン実行ファイルが、各[GitHub Release](https://github.com/e6nlaq/neoj/releases)に添付されています。

- `neoj-<version>-linux-x64`
- `neoj-<version>-linux-arm64`
- `neoj-<version>-darwin-x64`
- `neoj-<version>-darwin-arm64`
- `neoj-<version>-windows-x64.exe`

対応するファイルをダウンロードし、実行権限を付けて `PATH` の通った場所に置きます。

```bash
chmod +x neoj-<version>-linux-x64
./neoj-<version>-linux-x64 --version
```

macOS では、バイナリが未署名のため、最初の実行をGatekeeperが妨げることがあります。必要に応じて、検疫属性を外します。

```bash
xattr -d com.apple.quarantine ./neoj-<version>-darwin-arm64
```

すべてのアセットのSHA-256チェックサムは、同じリリースの `SHA256SUMS.txt` として公開されています。

## 必要なもの

`neoj` の実行には、[Bun](https://bun.com) 1.4以降が必要です。Bunがまだなければ、先に[Bunのインストールガイド](https://bun.com/docs/installation)を読みます。

CLIが `PATH` 上にあるかを確認します。

```bash
neoj --help
```

## 次に読む文書

- [最初の問題](../tutorial.md)を進めます。
- [プラットフォームにログインします](manage-sessions.md)。
