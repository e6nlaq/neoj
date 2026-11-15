# Credential storage

`neoj` stores every platform session in the operating system's credential
storage through the [Bun secrets API](https://bun.sh/docs/runtime/secrets#overview),
with an encrypted file in the per-user data directory chosen by
[`env-paths`](https://github.com/sindresorhus/env-paths) as a fallback.

## Where credentials are stored

By default, credentials are stored per platform and per credential name in the
OS credential storage:

| Platform | Storage                                            |
| -------- | -------------------------------------------------- |
| Linux    | secret service (libsecret, GNOME Keyring, KWallet) |
| macOS    | Keychain                                           |
| Windows  | Credential Manager                                 |

Credentials are stored under the service name `dev.neoj.cli`, one entry per
platform credential, named `<platform>/<credential>` (for example
`atcoder/revelSession` or `codeforces/jsessionId`). Entries are written with
local persistence on Windows (`persist: "local"`), so a roaming profile does not
replicate them to other computers. Because the secrets API cannot enumerate
entries, the names of saved credentials (never their values) are tracked in an
`auth-index.json` file in the data directory.

When the OS credential storage is unavailable — for example a headless Linux
server without a secret service daemon — `neoj` falls back automatically to an
encrypted file and reports the switch once:

| Platform | Fallback path                                        |
| -------- | ---------------------------------------------------- |
| Linux    | `~/.local/share/neoj-nodejs/auth.enc`                |
| macOS    | `~/Library/Application Support/neoj-nodejs/auth.enc` |
| Windows  | `%LOCALAPPDATA%\neoj-nodejs\Data\auth.enc`           |

The fallback file is a JSON envelope (`v`, `alg`, `iv`, `tag`, `data`) holding
the AES-256-GCM ciphertext of the saved credentials. The 256-bit encryption key
is generated once and stored in a separate `auth.key` file in the same
directory. Because the key lives on the same disk, the encryption protects the
credentials against exposure to backups, scanners, and other processes that
copy files, but not against an attacker who can read the whole data directory as
your user.

Set the `NEOJ_SECRETS_BACKEND` environment variable to force a backend: `auto`
(default), `os`, or `file`.

In `auto` mode, `neoj` uses the encrypted fallback file whenever `auth.enc`
exists in the data directory, and the OS credential storage otherwise. This
keeps the choice stable across processes: once the fallback file has been
written, later commands keep reading it instead of silently reading an empty OS
store. If both stores hold credentials, the encrypted file wins in `auto` mode;
use `NEOJ_SECRETS_BACKEND=os` to read credentials that only exist in the OS
credential storage. Logging out of every platform deletes the fallback file, so
`auto` mode goes back to the OS credential storage afterwards.

## Saved credentials

- AtCoder stores its session cookie as `revelSession`.
- Codeforces stores two browser cookies: `jsessionId` (`JSESSIONID`) and `ftaa`
  (`70a7c28f3de`). Codeforces rotates them, so the saved values are updated
  whenever a response replaces either value.
- yukicoder stores either a CLI token (`method: "token"`, `token`, `expiresAt`)
  or an account API key (`method: "api-key"`, `apiKey`). The CLI token expires
  24 hours after it is issued; an expired token is treated as logged out.
- ShareOJ stores `method: "password"` with `accessToken` and `refreshToken`,
  plus the access token's `expiresAt`. The access token expires within 24
  hours; `neoj` refreshes it with the refresh token (valid for about 30 days)
  and saves the new pair automatically.

The yukicoder token is used as a `Bearer` credential and is only valid for
submitting and checking the logged-in user. An API key has broader access and
should be treated the same way as a password. The ShareOJ tokens and the
Codeforces cookies grant the same access as a browser login and must be treated
like a password.

Credentials are rewritten whenever a session is saved or removed, and every
entry is deleted once no platform sessions remain.

## Migration

`neoj` previously stored credentials in a plain JSON `auth.json` file. On the
first authentication access, that file is migrated automatically into the active
store and deleted after the migrated values are verified. Migration keeps the
legacy file when it cannot complete, and logging out always works even when the
legacy file is malformed.

## Permissions

- The data directory is created with `0700`.
- Every file `neoj` writes there (`auth-index.json`, `auth.enc`, `auth.key`) is
  created with `0600` on POSIX systems. Permission changes are skipped on
  platforms that do not support them, such as Windows.
- Writes go to a temporary file in the same directory and are then renamed, so
  an interrupted run cannot leave a truncated credential file.

## Related

- [Log in, check status, and log out](../how-to/manage-sessions.md)
- [Why sessions are handled this way](../explanation/sessions.md)
