[English](../../how-to/download-samples.md) | 日本語

> この文書は日本語版です。英語版の更新が反映されていないことがあるため、内容が異なるときは[英語版](../../how-to/download-samples.md)が正です。

# サンプルテストをダウンロードする

```bash
neoj download <url>
neoj d <url>          # alias
```

このコマンドはAtCoderまたはyukicoderの問題URLを受け付け、設定済みのテストケースディレクトリをその問題のサンプルで置き換えます。

```bash
neoj d https://atcoder.jp/contests/abc300/tasks/abc300_a
neoj d https://yukicoder.me/problems/no/480
```

yukicoderでは、`/problems/no/<number>` と `/problems/<problem-id>` の両方のURLを受け付けます。これらは別の識別子です。同じ数値がそれぞれの形式では別の問題を指すことがあります。ダウンロードできるのは公開問題だけです。yukicoderのCLIトークンとAPIキーではHTMLの問題ページの認証ができないため、非公開問題はまだ対応していません。

## 実行前に

このコマンドには `neoj.toml` を持つプロジェクトが必要です。まだ作っていないなら、空のディレクトリで [`neoj init`](../tutorial.md) を実行します。`neoj` は現在のディレクトリとその祖先から近い方の `neoj.toml` を探し、リポジトリのルートで止まるため、プロジェクトのサブディレクトリから実行できます。

## コマンドの動作

1. 対応するプラットフォームの統合を通じて問題を取得します。
2. `stash.auto_stash = true` で問題が変わったときは、前の問題の作業ファイルを保存します。
3. テストケースフォルダ(既定は `test/`)を `sample-*.in` と `sample-*.out` のファイルで置き換えます。サンプル1つに1組です。手作りのケースも含め、そこに置いたファイルは削除されます。
4. `template.enable = true` で問題が変わったときは、プロジェクトテンプレートを `src/` に適用します。
5. `stash.auto_apply = true` で問題が変わり、退避が存在するときは、ダウンロードした問題の退避を復元します。
6. 問題URLを `.neoj/problem.json` に記録します。AtCoderでは競技の開催時間も記録します。yukicoderの問題はURLだけを保存します。

同じ問題をもう一度ダウンロードしたときは、テストケースフォルダを更新するだけです。テンプレートと退避は再適用されないため、`src/` の下の作業ファイルに加えた変更はそのまま残ります。

完了時の報告には、書き込んだサンプルの数が入ります。`download.show_sample = true` を設定すると、各サンプルの中身も表示します。

## 失敗したとき

- 取得に失敗しても、既存のテストケースはそのまま残ります。フォルダが置き換わるのは、問題の取得が終わったあとです。
- AtCoderの問題が404を返し、ログインしていないときは、エラーが `neoj login atcoder` の実行を促します。
- 存在しない問題を指すyukicoderのURLは、サイトがHTTP 200を返していても、問題ページが見つからないものとして報告します。
- サンプルのない問題では、テストケースフォルダを空のディレクトリとして作り直します。

## 関連文書

- [フォルダ名やファイル名を変える](configure-project.md)
- [サンプルテストをビルドして実行する](run-tests.md)
- [解法テンプレートを適用する](configure-project.md#テンプレートを適用する)
- [作業を問題ごとに退避・復元する](stash-work.md)
- [CLIリファレンス](../reference/cli.md)
