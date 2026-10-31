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
that platform's credentials; AtCoder stores its session cookie as
`revelSession`.

```json
{
    "atcoder": {
        "revelSession": "..."
    }
}
```

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
