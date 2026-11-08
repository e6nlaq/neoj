[English](../../how-to/submit-solution.md) | 日本語

> この文書は日本語版です。英語版の更新が反映されていないことがあるため、内容が異なるときは[英語版](../../how-to/submit-solution.md)が正です。

# 解法を提出する

```bash
neoj submit
neoj submit src/main.cpp
neoj s                        # alias
neoj submits                  # alias
```

`neoj submit` は、`.neoj/problem.json` に記録された問題へ解法を送ります。先に問題をダウンロードしてください。AtCoderとyukicoderに対応しています。

## 提出前に

初期化したプロジェクトの `neoj.toml`、ダウンロード済みの問題、そして `neoj test` が使うのと同じ `[languages.<key>]` セクションが必要です。

```toml
[test]
source = "src/main.cpp"

[languages.cpp]
source = "src/**/*.cpp"
compile = ["g++", "-std=c++23", "-O2", "-o", "{outfile}", "{source}"]
run = ["{outfile}"]
submit = { atcoder = "<id>" }
```

`submit` は、各プラットフォームを、その提出フォームが使う言語IDに対応付けます。キーがないときは、コマンドが使えるIDの一覧を表示し、`1` で終了します。`neoj languages <platform>` は同じ一覧をいつでも表示し、設定済みのIDに `*` を付け、`--filter` で表を絞り込めます。プラットフォームを省くと、現在の問題が使われます。正しいIDを `neoj.toml` に書き込むか、1回の実行だけ渡します。

```bash
neoj languages atcoder --filter python
neoj submit --platform-language <id>
```

`neoj submit` はファイルをコンパイルしません。サンプルを確かめたければ、先に `neoj test` を実行します。

## 確認し、待ち、提出する

コマンドは提出するテキストのプレビューを表示し、確認を求め(既定は **No**)、数秒待ち、提出します。

```text
Submitting src/main.cpp (languages.cpp, AtCoder)
12 line(s), 214 B

 1 | #include <bits/stdc++.h>
 2 | using namespace std;
...
11 |     return 0;
12 | }

Submit src/main.cpp to AtCoder? (y/N)
```

プレビューは、最初と最後の `submit.preview_lines` 行(既定は5)を実際の行番号付きで表示し、短いファイルは全体を表示します。そのあと、Ctrl-C を押せるようにカウントダウンが流れます。既定は3秒です。

| オプション         | 効果                            |
| ------------------ | ------------------------------- |
| `--yes`            | 確認のプロンプトを飛ばします。  |
| `--wait <seconds>` | 1回の実行の待ち時間を変えます。 |
| `--no-wait`        | すぐに提出します。              |

`--yes` が飛ばすのはプロンプトだけです。待ち時間は引き続き流れます。確認や待ち時間を中断すると、提出せずに `0` で終了します。

確認のプロンプト、待ち時間、ブラウザの動作は `[submit]` テーブルから決まります。

```toml
[submit]
confirm = true
wait = 3
open = true
clip = "never"
preview_lines = 5
```

提出が成功すると、neoj は提出IDとURLを表示し、そのページをブラウザで開きます。ブラウザを起動できなくても、警告が出るだけです。ターミナルに留まるには `--no-open` を渡すか、`submit.open = false` を設定します。

## 一度ログインしておく

有効なセッションが保存されていないとき、`neoj submit` はログインの流れを自動で始めます。ログインを中断すると `0` で終わり、失敗すると `1` で終わります。`login.auto_login = false` を設定すると、コマンドを失敗させ、`neoj login <platform>` を自分で実行することになります。

[ログイン、状態の確認、ログアウト](manage-sessions.md)を参照してください。

## 提出するテキストを用意する

マクロの展開やコメントの除去のような、変換の一手間が必要な言語があります。言語に `presubmit` を設定します。

```toml
[languages.cpp]
source = "src/**/*.cpp"
run = ["{outfile}"]
presubmit = ["python", "tools/expand.py", "{source}", "{outfile}"]
```

コマンドはプロジェクトのルートで実行されます。`{source}` はファイルの絶対パス、`{outfile}` はソースの拡張子を保った一時ファイルです。提出するテキストを `{outfile}` に書き込むか、コマンドが `{outfile}` に触れないときは標準出力に出します。元のファイルが変わることはなく、一時ディレクトリはそのあと削除されます。

環境には `NEOJ_PLATFORM`、`NEOJ_PROBLEM_URL`、`NEOJ_LANGUAGE` も渡されます。コマンドが失敗する、タイムアウトする(既定は30秒)、出力が空になる、のいずれかのとき、その標準エラーとともに提出が止まります。1回の実行でファイルをそのまま送るには `--no-presubmit` を使い、時間を伸ばすには `submit.presubmit_timeout` を上げます。

## 提出せずに確かめる

```bash
neoj submit --dry-run
```

`--dry-run` は presubmit のコマンドを実行し、プレビューと大きさを表示します。ログインも、プラットフォームへの問い合わせも、言語IDの解決も、クリップボードへのコピーもしません。`--wait`、`--no-wait`、`--open`、`--no-open`、`--yes` を無視し、`--platform-language` とは併用できません。

## クリップボードにコピーを残す

`submit.clip` が、提出するテキストをクリップボードにコピーするかどうかを決めます。

```toml
[submit]
clip = "never"   # default
# clip = "always"  # copy after presubmit, then submit
# clip = "fail"    # copy only when submitting fails
```

`"always"` は、クリップボードが使えなくても提出します。警告を出すだけです。`"fail"` は、自動提出が妨げられたときに使えます。テキストがブラウザのフォームに貼り付けられる状態で残るためです。この場合でも、コマンドは `1` で終了します。

## 自動提出が妨げられるとき

AtCoderは状況によってTurnstileを適用するため、自動化が確実に動くのは競技の開催時間の中だけです。`neoj submit` は次のとき警告します。

- 競技IDが `adt_` で始まる(AtCoder Daily Training)。
- 現在の時刻が、`neoj download` が保存した競技の開催時間の外にある。
- 提出ページにTurnstileのチャレンジが含まれる。

警告は提出を止めません。AtCoderが要求を拒否したとき、エラーには提出ページのURLが入ります。ブラウザで開き、そこから提出してください。その場合は `submit.clip = "fail"` を設定しておくと、テキストが貼り付けられる状態で残ります。

yukicoderは、ウェブフォームと同じAPIで提出を受け付けるため、競技の開催時間は記録されず、必要ありません。

## 関連文書

- [サンプルテストをビルドして実行する](run-tests.md)
- [ログイン、状態の確認、ログアウト](manage-sessions.md)
- [設定リファレンス](../reference/configuration.md)
- [CLIリファレンス](../reference/cli.md)
