English | [日本語](../ja/credentials.md)

# Credential storage

`neoj` stores every platform session in one JSON file inside the per-user data
directory chosen by [`env-paths`](https://github.com/sindresorhus/env-paths).

## Location

| Platform | Path                                                  |
| -------- | ----------------------------------------------------- |
| Linux    | `~/.local/share/neoj-nodejs/auth.json`                |
| macOS    | `~/Library/Application Support/neoj-nodejs/auth.json` |
| Windows  | `%LOCALAPPDATA%\neoj-nodejs\Data\auth.json`           |

## Format

The file is a JSON object keyed by platform name. Each value is an object of
that platform's credentials:

- AtCoder stores its session cookie as `revelSession`.
- yukicoder stores either a CLI token (`method: "token"`, `token`, `expiresAt`)
  or an account API key (`method: "api-key"`, `apiKey`). The CLI token expires
  24 hours after it is issued; an expired token is treated as logged out.

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

The yukicoder token is used as a `Bearer` credential and is only valid for
submitting and checking the logged-in user. An API key has broader access and
should be treated the same way as a password.

The file is rewritten whenever a session is saved or removed, and deleted once
no platform sessions remain.

## Permissions

- The data directory is created with `0700`.
- The file is created with `0600` on POSIX systems. Permission changes are
  skipped on platforms that do not support them, such as Windows.
- Writes go to a temporary file in the same directory and are then renamed, so
  an interrupted run cannot leave a truncated credential file.

## Related

- [Log in, check status, and log out](../how-to/manage-sessions.md)
- [Why sessions are handled this way](../explanation/sessions.md)
