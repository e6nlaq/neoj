[English](../../how-to/setup-editor-completions.md) | 日本語

> この文書は日本語版です。英語版の更新が反映されていないことがあるため、内容が異なるときは[英語版](../../how-to/setup-editor-completions.md)が正です。

# エディタ補完を設定する

`neoj` はTOML設定のJSON Schemaを公開しています。TOML文書にJSON Schemaを関連付けたエディタでは、設定キーが補完され、ホバーで説明が表示されます。スキーマは、`neoj` が設定の検証に使うのと同じ定義から生成されるため、キー、既定値、許される値はCLIが受け付けるものと一致します。

```text
https://raw.githubusercontent.com/e6nlaq/neoj/main/schema/neoj.schema.json
```

## VS Code

[Even Better TOML](https://marketplace.visualstudio.com/items?itemName=tamasfe.even-better-toml) をインストールします。Taploを基盤とするTOMLサポートが加わり、`#:schema` ディレクティブも使えます。

`neoj init` は、このディレクティブをプロジェクトの `neoj.toml` の先頭行として書き込みます。それより前に作ったプロジェクトでは、ファイルのいちばん上に自分で次の行を加えます。

```toml
#:schema https://raw.githubusercontent.com/e6nlaq/neoj/main/schema/neoj.schema.json
```

ディレクティブは、どのキーやテーブルよりも前に置く必要があり、1つの文書に入れられるのは1つだけです。拡張機能の設定は不要です。

## グローバル設定

`neoj` は `~/.neoj.toml` を作りません。ファイルを作るときに、同じ先頭行を加えます。

```toml
#:schema https://raw.githubusercontent.com/e6nlaq/neoj/main/schema/neoj.schema.json

[login]
open_browser = false
```

## その他のエディタ

`#:schema` ディレクティブはTaploの機能のため、Taploの言語サーバーを持つエディタであれば読めます。Zed、Helix、Taploの言語サーバーを入れたNeovimなどが含まれます。

## オフラインでの利用

スキーマのコピーを手元に置き、ディレクティブをそのパスに向けてください。相対パスはTOMLファイルからの位置で解決されます。

```toml
#:schema ./path/to/neoj.schema.json
```

## 制限

- スキーマはエディタの補助です。`neoj` は結合後の設定を引き続き検証し、実行時には未知のキーを拒否します。
- URLは `main` を指すため、スキーマは最新の開発状態を表します。インストール済みのリリースより後に追加されたキーは、エディタでは補完されますが、`neoj` には拒否されます。
- `src` とすべての `[template]` キーはプロジェクト専用です。両方のファイルが1つのスキーマを共有するため、エディタは `~/.neoj.toml` でも受け付けますが、`neoj` はそこで設定された場合にエラーを報告します。
- スキーマはまだJSON Schema Storeに登録されていないため、TOMLファイルがスキーマを読むには `#:schema` の行が必要です。

## 次に読む文書

- すべてのキーと既定値は[設定リファレンス](../reference/configuration.md)にあります。
- [プロジェクトを設定する](configure-project.md)。
