[English](../../how-to/manage-sessions.md) | 日本語

> この文書は日本語版です。英語版の更新が反映されていないことがあるため、内容が異なるときは[英語版](../../how-to/manage-sessions.md)が正です。

# ログイン、状態の確認、ログアウト

認証情報はプラットフォームごとに保存されるため、それぞれ独立してログインしたままにできます。`neoj` は認証情報を保存する前に検証し、画面には絶対に表示しません。

## AtCoder にログインする

```bash
neoj login atcoder
```

1. ブラウザでAtCoderを開き、DevTools(Application → Cookies)からセッションcookieをコピーします。AtCoderのcookieは `REVEL_SESSION` です。
2. 値をプロンプトに貼り付けます。値だけ、または `REVEL_SESSION=...` のペア全体のどちらも受け付け、前後の空白は無視します。`;` を含むcookieヘッダ全体ではなく、そのcookieだけを貼り付けてください。
3. `neoj` は保存する前に、セッションをAtCoderに問い合わせて確認します。

## yukicoder にログインする

既定の方法では、提出と現在のユーザーの確認だけを許されたCLIトークンを使います。トークンは24時間で有効期限が切れます。

```bash
neoj login yukicoder
```

1. `neoj` がyukicoderにデバイスコードを要求し、URLと短いコードを表示します。
2. `login.open_browser = true`(既定)のとき、`neoj` がブラウザで `https://yukicoder.me/device` を開きます。ブラウザで要求を承認します。
3. `neoj` はトークンを受け取るまでyukicoderを問い合わせ続け、トークンと有効期限を保存します。

ブラウザを開けない場合(SSH経由など)は、表示されたURLを手で開きます。自動で開くのを止めるには、`~/.neoj.toml` で `login.open_browser = false` を設定します。

アカウントのAPIキーを使うこともできます。

```bash
neoj login yukicoder --method api-key
```

yukicoderのプロフィールからAPIキーを貼り付けます。APIキーはCLIトークンより広いアクセス権を持つため、パスワードと同じように扱います。

そのプラットフォームにすでにログインしているときは、`neoj` が保存済みの認証情報を入れ替える前に確認を求めます。有効期限が切れたyukicoderトークンは、確認なしで入れ替えます。

> どの認証情報もパスワードと同じように扱います。そのプラットフォームのアカウントへのアクセスを許すものです。共有したり、リポジトリにコミットしたりしないでください。

## ログイン状態を確認する

```bash
neoj status
```

`status` は、対応しているすべてのプラットフォームについて、認証情報を保存しているかどうかを報告します。有効期限が切れたyukicoder CLIトークンは、サービスに問い合わせずにログアウト済みと報告します。

`--offline` を付けると、ネットワーク要求を省きます。

```bash
neoj status --offline
```

オフラインのとき、`neoj` は保存済みの認証情報だけを読み、プラットフォームに問い合わせる代わりに `Logged in (offline, not verified)` と報告します。

## ログアウト

1つのプラットフォームからログアウトします。

```bash
neoj logout --service atcoder
```

認証情報を保存しているすべてのプラットフォームからログアウトします。

```bash
neoj logout
```

`neoj` は認証情報を削除する前に確認を求めます。存在しないプラットフォーム名はエラーになり、対応している名前の一覧が表示されます。

## 関連文書

- [セッションの保存場所](../reference/credentials.md)
- [セッションの保護の仕組み](../explanation/sessions.md)
