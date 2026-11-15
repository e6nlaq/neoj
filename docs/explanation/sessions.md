# Sessions and credential security

`neoj` stores credentials per platform. AtCoder uses a browser session cookie;
Codeforces uses two browser cookies (`JSESSIONID` and `70a7c28f3de`);
yukicoder uses a submit-only CLI token from the browser device flow or an account
API key; ShareOJ uses the access and refresh tokens issued by its own CLI login
endpoints. That keeps the CLI simple and avoids storing a password, but it means
each credential is exactly as powerful as what the platform grants it.

## Verify before saving

A pasted cookie or API key is checked against the platform before it is written
to disk. A typo or an expired yukicoder token fails immediately instead of
producing confusing errors later. yukicoder CLI tokens are saved with their
expiry time and treated as logged out once that time passes. A ShareOJ login is
verified against `/auth/me` before the tokens replace the saved session, and an
expired access token is refreshed automatically while its refresh token lasts.

## Keep the blast radius small

Credentials live in the operating system's credential storage (macOS Keychain,
Windows Credential Manager, or the Linux secret service) through the Bun secrets
API, one entry per platform credential under the service name `dev.neoj.cli`.
They are never written to the project directory.

When the OS credential storage is unavailable, `neoj` falls back to an
AES-256-GCM encrypted file in the per-user data directory:

- The directory is created with `0700` and every file `neoj` writes there is
  created with `0600` on POSIX systems.
- Writes use a temporary file and a rename, so an interrupted run cannot
  truncate the saved sessions.
- Logging out of the last platform deletes the stored credentials instead of
  leaving an empty record behind.

The fallback encryption protects the saved sessions from being read by backups,
file scanners, and other processes that copy files, but the encryption key sits
in the same data directory, so malware running as your user can still read the
credentials. `neoj` never prints a credential in logs or error messages.

See [where credentials are stored](../reference/credentials.md) for the exact
locations, the backend override, and the automatic migration from the legacy
plaintext `auth.json` file.

## What this does not protect against

- An AtCoder session cookie grants full access to the account until it expires;
  there is no per-command scope. A yukicoder API key has broad access as well.
  The yukicoder CLI token is limited to submitting and checking the current user,
  and expires after 24 hours, but it is still a secret while valid. A ShareOJ
  access token grants what a browser session grants, and its refresh token can
  mint new access tokens for about 30 days.
- Malware or another process running as your user can retrieve the credentials,
  both from the OS credential storage (it runs with your user's access) and
  from the encrypted fallback file (the encryption key is on the same disk).
- A credential copied into a repository, issue, or chat is compromised even after
  you log out elsewhere.

Treat every credential like a password and log out when you no longer need it.

## Related

- [Where credentials are stored](../reference/credentials.md)
- [Log in, check status, and log out](../how-to/manage-sessions.md)
