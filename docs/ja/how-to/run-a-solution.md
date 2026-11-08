[English](../../how-to/run-a-solution.md) | 日本語

> この文書は日本語版です。英語版の更新が反映されていないことがあるため、内容が異なるときは[英語版](../../how-to/run-a-solution.md)が正です。

# テストなしで解法を実行する

```bash
neoj run
neoj run src/main.cpp
neoj r                        # alias
```

`neoj run` は解法をビルドし、ターミナルを接続したまま起動します。テストケースのディレクトリを読まず、出力を比較せず、制限をかけないため、プログラムを手で試したり、自分の引数を渡したりする手軽な方法です。

## 実行前に

`neoj.toml` と `[languages.<key>]` セクションを持つプロジェクトが必要です。`neoj test` が使うのと同じものです。

```toml
[test]
source = "src/main.cpp"

[languages.cpp]
source = "src/**/*.cpp"
compile = ["g++", "-std=c++23", "-O2", "-o", "{outfile}", "{source}"]
run = ["{outfile}"]
```

ダウンロード済みのサンプルは不要です。`test/` がなくても `neoj run` は動き、`.in` や `.out` のファイルを開きません。

## 入力を打ち、出力を見る

プログラムの標準入力、標準出力、標準エラーは、ターミナルに直接つながります。neoj は取得も、装飾も、切り詰めもしません。

```bash
neoj run
1 2
3
```

対話的なプログラム、色、Ctrl-C は、自分でプログラムを起動したのと同じように動きます。時間制限もメモリ制限も、出力8MiBの上限もありません。

neoj 自身のログは標準エラーに出るため、標準出力はきれいなままです。

```text
Compiled src/main.cpp (languages.cpp) in 412 ms.
```

## プログラムに引数を渡す

ソースファイルより後ろはすべて、そのままプログラムに渡ります。

```bash
neoj run src/main.cpp 5 7
neoj run src/main.cpp --fast -x 1
```

そのため、neoj のオプションはソースファイルより前に置きます。

```bash
neoj run --cache src/main.cpp 5 7
neoj run --silent src/main.cpp
```

`test.source` を使いながら引数を渡すには、引数の前に `--` を置きます。

```bash
neoj run -- 5 7
neoj run -l cpp -- -x 1
```

最初の `--` は区切りで、その後ろはすべてプログラムに渡ります。2つ目の `--` はそのまま渡ります。

## ソースファイルを選ぶ

ソースの解決は `neoj test` とまったく同じです。`[source]` 引数、`[alias]` の名前、`test.source` のいずれかを、言語の `source` グロブと照合します。複数が一致するときは、`-l`、`--language <key>` で言語を選びます。

```toml
[alias]
main = "src/main.cpp"
```

```bash
neoj r main
```

解決の規則は[サンプルテストをビルドして実行する](run-tests.md#ソースファイルを選ぶ)にあります。

## ビルドログを静かにする

`--silent` は、コンパイル結果やキャッシュの再利用の行のような、情報としてのログを隠します。

```bash
neoj run --silent src/main.cpp
```

設定で常時指定できます。

```toml
[run]
silent = true
```

エラーは決して隠れません。コンパイラの診断、コンパイルの失敗、ソースファイルが見つからないことは、常に表示されます。

標準エラーがターミナルでないときは、ログが自動で隠れます。リダイレクトやパイプでの実行は、追加のフラグなしで静かになります。

```bash
neoj run > out.txt 2>&1
```

## ビルドをキャッシュする

`neoj run` は `test.cache` と `.neoj/build/` のディレクトリを `neoj test` と共有するため、片方のコマンドが作ったビルドをもう片方が再利用します。1回の実行だけ設定を上書きするには `--cache` か `--no-cache` を使います。`--no-cache` は、プログラムの終了時にその実行のビルドディレクトリを削除します。`neoj prune` はキャッシュされたビルドをすべて削除します。

## 終了ステータス

`neoj run` はプログラム自身の終了コードで終わるため、スクリプトから直接確かめられます。設定、コンパイル、起動のエラーは `1` を返します。シグナルで終了させられたプログラムも `1` を返し、`--silent` がなければ1行の知らせを表示します。

## 関連文書

- [サンプルテストをビルドして実行する](run-tests.md)
- [プロジェクトを設定する](configure-project.md)
- [設定リファレンス](../reference/configuration.md)
- [CLIリファレンス](../reference/cli.md)
