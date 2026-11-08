[English](../../reference/credentials.md) | 日本語

> この文書は日本語版です。英語版の更新が反映されていないことがあるため、内容が異なるときは[英語版](../../reference/credentials.md)が正です。

# 認証情報の保存

`neoj` は、すべてのプラットフォームのセッションを、[`env-paths`](https://github.com/sindresorhus/env-paths)が選ぶユーザーごとのデータディレクトリの中の1つのJSONファイルに保存します。

## 場所

| プラットフォーム | パス                                                  |
| ---------------- | ----------------------------------------------------- |
| Linux            | `~/.local/share/neoj-nodejs/auth.json`                |
| macOS            | `~/Library/Application Support/neoj-nodejs/auth.json` |
| Windows          | `%LOCALAPPDATA%\neoj-nodejs\Data\auth.json`           |

## 形式

ファイルは、プラットフォーム名をキーにしたJSONオブジェクトです。各値は、そのプラットフォームの認証情報のオブジェクトです。

- AtCoderはセッションcookieを `revelSession` として保存します。
- yukicoderは、CLIトークン(`method: "token"`、`token`、`expiresAt`)か、アカウントのAPIキー(`method: "api-key"`、`apiKey`)のどちらかを保存します。CLIトークンは発行から24時間で有効期限が切れ、切れたトークンはログアウト済みとして扱われます。

```json
{
    "atcoder": {
        "revelSession": "..."
    },
    "yukicoder": {
        "method": "token",
        "token": "ysb_...",
        "expiresAt": "2026-11-02T00:00:00Z"
    }
}
```

yukicoderのトークンは `Bearer` 認証情報として使われ、提出とログイン中ユーザーの確認にだけ有効です。APIキーはより広いアクセスを持つため、パスワードと同じように扱います。

セッションを保存または削除するたびにファイルが書き直され、プラットフォームのセッションがなくなると削除されます。

## 権限

- データディレクトリは `0700` で作られます。
- POSIX のシステムではファイルは `0600` で作られます。権限の変更をサポートしないプラットフォーム(Windowsなど)では、変更を飛ばします。
- 書き込みは同じディレクトリの中の一時ファイルに向けられ、そのあと名前が変更されるため、途中で終了した実行が切り詰められた認証情報ファイルを残しません。

## 関連文書

- [ログイン、状態の確認、ログアウト](../how-to/manage-sessions.md)
- [セッションをこのように扱う理由](../explanation/sessions.md)
