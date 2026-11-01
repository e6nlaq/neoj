# Sessions and credential security

`neoj` stores credentials per platform. AtCoder uses a browser session cookie;
yukicoder uses a submit-only CLI token from the browser device flow or an account
API key. That keeps the CLI simple and avoids storing a password, but it means
each credential is exactly as powerful as what the platform grants it.

## Verify before saving

A pasted cookie or API key is checked against the platform before it is written
to disk. A typo or an expired yukicoder token fails immediately instead of
producing confusing errors later. yukicoder CLI tokens are saved with their
expiry time and treated as logged out once that time passes.

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

- An AtCoder session cookie grants full access to the account until it expires;
  there is no per-command scope. A yukicoder API key has broad access as well.
  The yukicoder CLI token is limited to submitting and checking the current user,
  and expires after 24 hours, but it is still a secret while valid.
- Malware or another process running as your user can read the file.
- A credential copied into a repository, issue, or chat is compromised even after
  you log out elsewhere.

Treat every credential like a password and log out when you no longer need it.

## Related

- [Where credentials are stored](../reference/credentials.md)
- [Log in, check status, and log out](../how-to/manage-sessions.md)
