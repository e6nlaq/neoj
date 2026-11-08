[English](../../how-to/setup-completions.md) | 日本語

> この文書は日本語版です。英語版の更新が反映されていないことがあるため、内容が異なるときは[英語版](../../how-to/setup-completions.md)が正です。

# シェル補完を設定する

`neoj` は、bash、zsh、fish、PowerShell 向けの静的な補完スクリプトを標準出力に書き出します。出力先が標準出力のため、シェルが設定を読む場所にインストールします。

```bash
neoj completions <shell>
neoj completion <shell>   # alias
```

`<shell>` を `bash`、`zsh`、`fish`、`powershell` のいずれかに置き換えます。`neoj` を更新したあとはスクリプトを生成し直し、新しいコマンドやオプションを補完に反映させます。

## Bash

`~/.bashrc` に次の行を追加します。

```bash
eval "$(neoj completions bash)"
```

Bash は候補の横に説明を表示できないため、表示されるのはコマンド名、オプション名、値の名前だけです。

## Zsh

先に `compinit` を読み込み、そのうえで `~/.zshrc` に次の行を追加します。

```zsh
eval "$(neoj completions zsh)"
```

`fpath` の通ったディレクトリにスクリプトをインストールすることもできます。

```zsh
neoj completions zsh > "${fpath[1]}/_neoj"
```

生成されるスクリプトは `#compdef neoj` で始まり、どちらの読み込み方法にも対応します。ファイルを書き込んだあとは、`compinit` をもう一度実行します。

## Fish

Fish の補完ディレクトリにスクリプトを書き込みます。

```fish
neoj completions fish > ~/.config/fish/completions/neoj.fish
```

Fish はこのディレクトリのファイルを自動で読み込むため、追加の設定は不要です。

## PowerShell

PowerShell の補完には、コマンド引数のネイティブコンプリーターを備えた PowerShell 7.2以降が必要です。`$PROFILE` に次の行を追加します。

```powershell
neoj completions powershell | Out-String | Invoke-Expression
```

Windows PowerShell 5.1 はネイティブの引数コンプリーターを持たないため、`neoj` の補完は使えません。

## 補完される候補

- コマンドとそのエイリアス(`d`、`o`、`h`、`langs`、`completion`)、`login atcoder` や `stash save` のようなサブコマンド。
- `neoj login atcoder` や `neoj stash save` のような、入れ子になったコマンドのオプション。
- ログインコマンド、`--service`、`neoj languages` の引数に対するプラットフォーム名(`atcoder`、`yukicoder`)。
- `neoj login yukicoder --method` に対する `token` と `api-key`。
- `neoj completions` に対するシェル名。

`neoj download` の `<url>` 引数には候補がなく、`neoj` はどの引数にもファイル名を提示しません。

## 次に読む文書

- [CLIリファレンス](../reference/cli.md)。
- [プロジェクトを設定する](configure-project.md)。
