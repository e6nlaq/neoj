# Sessions and credential security

`neoj` authenticates by reusing a browser session cookie. That choice keeps the
CLI simple and avoids storing a password, but it means the credential is exactly
as powerful as a logged-in browser tab.

## Verify before saving

A pasted cookie is checked against the platform before it is written to disk. A
typo or an expired session fails immediately instead of producing confusing
errors later.

## Keep the blast radius small

Credentials live in a single file in the per-user data directory, never in the
project directory:

- The directory is created with `0700` and the file with `0600` on POSIX
  systems.
- Writes use a temporary file and a rename, so an interrupted run cannot
  truncate the saved sessions.
- Logging out of the last platform deletes the file instead of leaving an empty
  one behind.

The file is plain JSON, so anything running as your user can read it. `neoj`
relies on operating-system file permissions rather than encryption, and it never
prints the cookie in logs or error messages.

## What this does not protect against

- A session cookie grants full access to the account until it expires; there is
  no per-command scope.
- Malware or another process running as your user can read the file.
- A cookie copied into a repository, issue, or chat is compromised even after
  you log out elsewhere.

Treat the cookie like a password and log out when you no longer need it.

## Related

- [Where credentials are stored](../reference/credentials.md)
- [Log in, check status, and log out](../how-to/manage-sessions.md)
