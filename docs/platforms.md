# Platforms

Commands stay the same wherever a problem is hosted; each platform is a separate
integration behind that surface. Pass the platform name to `login` and `logout`,
and use `status` to see the ones you have configured.

The examples on this page use AtCoder.

## Logging in

```bash
neoj login <platform>
```

1. Open the platform in your browser and copy its session cookie value from
   DevTools (Application → Cookies). For AtCoder, this is `REVEL_SESSION`.
2. Paste the value into the prompt. Either the raw value or `REVEL_SESSION=...`
   is accepted.
3. The session is verified against the platform before it is saved.

> Treat the session cookie like a password: it grants access to your account on
> that platform. Never share it or commit it to a repository.

## Checking status

```bash
neoj status
```

The command contacts each platform to check whether the saved session is still
valid. With `--offline`, `neoj` only reads the saved credentials and reports
`Logged in (offline, not verified)` instead.

## Signing out

```bash
neoj logout [--service <name...>]
```

`logout` removes the saved credentials of the given services, or of every service
when no name is given. Once no providers remain, the credential file is deleted.

## Credential storage

Saved credentials live in the per-user data directory chosen by
[`env-paths`](https://github.com/sindresorhus/env-paths):

| Platform | Path                                                  |
| -------- | ----------------------------------------------------- |
| Linux    | `~/.local/share/neoj-nodejs/auth.json`                |
| macOS    | `~/Library/Application Support/neoj-nodejs/auth.json` |
| Windows  | `%LOCALAPPDATA%\neoj-nodejs\Data\auth.json`           |

On POSIX systems the file is written with `0600` permissions. Writes are atomic,
so an interrupted run cannot truncate the existing credentials.
