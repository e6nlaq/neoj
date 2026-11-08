[English](../../how-to/create-handmade-tests.md) | 日本語

> この文書は日本語版です。英語版の更新が反映されていないことがあるため、内容が異なるときは[英語版](../../how-to/create-handmade-tests.md)が正です。

# テストケースを手で作る

```bash
neoj handmade
neoj h          # alias
```

`neoj handmade` はテストケースを1つ入力させ、ダウンロード済みのサンプルと同じ場所に `.in` ファイルと `.out` ファイルとして書き込みます。サンプルが確かめたいケースを網羅しないときに使います。

## ケースを入力する

```text
$ neoj handmade
test/handmade-1.in and test/handmade-1.out will be created.
input> 1 2
input>

output> 3
output>
✔ Created test/handmade-1.in and test/handmade-1.out.
```

入力を1行ずつ打ち、空行でEnterを押すとそのブロックが終わります。期待する出力も同じように打ち、空行が2つのブロックを分けます。空の入力や出力を作るときは、すぐにEnterを押します。

ファイルが書き込まれるのは、両方のブロックが完成したあとです。Ctrl-C または Ctrl-D(Windowsでは Ctrl-Z)でコマンドを中断すると、ディレクトリはそのまま残るため、打ち間違えたケースが片割れだけ残ることはありません。

このコマンドには対話的なターミナルが必要で、入力をパイプで渡すことはできません。

## 新しいケースを実行する

ファイルはサンプルと同じディレクトリにあるため、次の実行で読み込まれます。

```bash
neoj test
neoj test -f handmade-1     # 手作りのケースだけ
```

## ファイル名を選ぶ

`handmade.filename` がベース名を決めます。`{}` をちょうど1つ含み、そこがケース番号に置き換わります。

```toml
[handmade]
filename = "handmade-{}"
```

ディレクトリは `testcase.folder` で、`neoj download` が使うのと同じ1つです。コマンドは、`.in` と `.out` の両方のファイルがまだ存在しない最小の番号を選ぶため、既存のケースを上書きしません。番号を再利用したければ、もう使わないファイルを削除します。

## 注意

`neoj download` はテストケースのディレクトリ全体を置き換えます。別の問題をダウンロードすると、手作りのケースも古いサンプルとともに消えるため、残したいケースは先にどこかにコピーしてください。

## 関連文書

- [サンプルテストをダウンロードする](download-samples.md)
- [サンプルテストをビルドして実行する](run-tests.md)
- [フォルダ名やファイル名を変える](configure-project.md)
- [設定リファレンス](../reference/configuration.md)
