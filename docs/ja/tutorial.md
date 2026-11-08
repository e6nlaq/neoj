[English](../tutorial.md) | 日本語

> この文書は日本語版です。英語版の更新が反映されていないことがあるため、内容が異なるときは[英語版](../tutorial.md)が正です。

# 最初の問題

このチュートリアルでは、空のディレクトリから始めて、サンプルテストをディスクに保存するまでを進めます。所要時間は数分で、`neoj` が対応しているプラットフォームの一つであるAtCoderを使います。

## 始める前に

- [`neoj` をインストールします](how-to/install.md)。Bun 1.4以降が必要です。
- 公開問題からサンプルをダウンロードするだけなら、AtCoderアカウントは不要です。

## 1. プロジェクトを作る

```bash
mkdir my-first-problem
cd my-first-problem
neoj init
```

`neoj init` は、同梱のスターターファイルをディレクトリにコピーします。

| パス                | 内容                                                    |
| ------------------- | ------------------------------------------------------- |
| `neoj.toml`         | プロジェクトの設定。                                    |
| `src/main.cpp`      | スターター用ソースファイル。                            |
| `template/main.cpp` | 問題の変更後に適用される解法テンプレート。              |
| `.gitignore`        | `test/`、`.neoj/`、エディタや依存関係のファイルを除外。 |

同梱の設定ではテンプレートが有効になっているため、次の手順では `template/main.cpp` も `src/main.cpp` にコピーされます。

## 2. サンプルをダウンロードする

```bash
neoj d https://atcoder.jp/contests/abc300/tasks/abc300_a
```

yukicoder の問題URLも同じように扱えます。

```bash
neoj d https://yukicoder.me/problems/no/480
```

`neoj` は問題を取得し、サンプルを1つずつ `test/` に書き込み、`.neoj/problem.json` に問題を記録します。

## 3. 結果を確認する

```bash
ls test
```

フォルダには、サンプルごとに入力ファイルと出力ファイルが1組ずつ入ります。

```
test/
├── sample-1.in
├── sample-1.out
└── ...
```

入力ファイルを開いて問題ページと比べ、`src/main.cpp` に解法を書きます。

## 4. テストを実行する

```bash
neoj test
```

`neoj` は `src/main.cpp` をコンパイルし、すべてのサンプルで実行して、ケースごとに1行ずつ表示します。同梱の設定には `g++` を使う `cpp` 言語が定義されているため、`PATH` 上にC++コンパイラがあれば動きます。

## 5. 次に読む文書

- [テストフォルダやファイル名を変える](how-to/configure-project.md)。
- [言語を追加したり制限を調整したりする](how-to/run-tests.md)。
- [テストケースを手で作る](how-to/create-handmade-tests.md)。
- [問題を切り替える前に作業を退避する](how-to/stash-work.md)。
- 問題がアカウントを求めるときは[ログインします](how-to/manage-sessions.md)。
- [すべてのコマンドとフラグを調べる](reference/cli.md)。
