# Log in, check status, and log out

Sessions are stored per platform, so you can stay logged in to each one
independently. `neoj` verifies a session before saving it and never prints the
cookie back.

## Log in to a platform

```bash
neoj login atcoder
```

1. Open the platform in your browser and copy the session cookie from DevTools
   (Application → Cookies). For AtCoder, the cookie is `REVEL_SESSION`.
2. Paste the value into the prompt. Either the value alone or the whole
   `REVEL_SESSION=...` pair is accepted, and surrounding whitespace is ignored.
   Paste only that cookie, not a full cookie header that contains `;`.
3. `neoj` checks the session against the platform before saving it.

If you are already logged in to that platform, `neoj` asks for confirmation
before replacing the saved session.

> Treat a session cookie like a password: it grants access to your account on
> that platform. Never share it or commit it to a repository.

## Check the login status

```bash
neoj status
```

`status` reports every supported platform, whether or not you have saved a
session for it.

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
