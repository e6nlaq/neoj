English | [日本語](../ja/manage-sessions.md)

# Log in, check status, and log out

Credentials are stored per platform, so you can stay logged in to each one
independently. `neoj` verifies a credential before saving it and never prints it
back.

## Log in to AtCoder

```bash
neoj login atcoder
```

1. Open AtCoder in your browser and copy the session cookie from DevTools
   (Application → Cookies). For AtCoder, the cookie is `REVEL_SESSION`.
2. Paste the value into the prompt. Either the value alone or the whole
   `REVEL_SESSION=...` pair is accepted, and surrounding whitespace is ignored.
   Paste only that cookie, not a full cookie header that contains `;`.
3. `neoj` checks the session against AtCoder before saving it.

## Log in to yukicoder

The default method uses a CLI token that is only allowed to submit and to check
the current user. It expires after 24 hours.

```bash
neoj login yukicoder
```

1. `neoj` asks yukicoder for a device code and prints a URL and a short code.
2. `neoj` opens `https://yukicoder.me/device` in your browser when
   `login.open_browser = true` (the default). Approve the request there.
3. `neoj` polls yukicoder until it receives the token, then saves the token and
   its expiry time.

If you cannot open a browser (for example over SSH), open the printed URL
manually. Set `login.open_browser = false` in `~/.neoj.toml` to disable the
automatic launch.

To use your account API key instead:

```bash
neoj login yukicoder --method api-key
```

Paste the API key from your yukicoder profile. An API key has broader access than
the CLI token, so treat it like a password.

If you are already logged in to that platform, `neoj` asks for confirmation
before replacing the saved credentials. yukicoder tokens that have already
expired are replaced without asking.

> Treat every credential like a password: it grants access to your account on
> that platform. Never share it or commit it to a repository.

## Check the login status

```bash
neoj status
```

`status` reports every supported platform, whether or not you have saved
credentials for it. An expired yukicoder CLI token is reported as logged out
without contacting the service.

Add `--offline` to skip network requests:

```bash
neoj status --offline
```

Offline, `neoj` only reads the saved credentials and reports
`Logged in (offline, not verified)` instead of contacting the platform.

## Log out

Log out of one platform:

```bash
neoj logout --service atcoder
```

Log out of every platform with saved credentials:

```bash
neoj logout
```

`neoj` asks for confirmation before removing credentials. An unknown platform
name is an error that lists the supported names.

## Related

- [Where sessions are stored](../reference/credentials.md)
- [How sessions are protected](../explanation/sessions.md)
