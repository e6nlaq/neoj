# Platforms and integrations

`neoj` treats every contest site as a **platform**: a named integration that knows
how to log in, check a session, and read a problem. Commands are written once and
work the same way for every platform.

## The command surface

Platforms are registered with a name, a display name, and three operations: log
in, check whether a saved session is still valid, and report whether credentials
exist at all. The CLI uses that registry directly:

- `neoj login <platform>` exposes one subcommand per registered platform.
- `neoj logout --service <name...>` validates names against the registry.
- `neoj status` walks every registered platform, so the output is stable
  regardless of which sessions you have saved.

This is why adding a platform does not change the shape of the CLI: the commands
stay the same and only the registry grows.

## Selecting a platform

`login` and `logout` take the platform name. `download` receives a URL instead, so
the URL parser decides which integration handles it. The parser rejects URLs that
do not belong to a supported platform rather than attempting a best-effort fetch.

AtCoder and yukicoder are the registered platforms. They authenticate
differently:

- AtCoder reuses a browser session cookie (`REVEL_SESSION`).
- yukicoder uses either a submit-only CLI token obtained through the browser
  device flow, or an account API key stored as a `Bearer` credential.

Every credential is verified before `neoj` saves it.

Aizu Online Judge (AOJ) and Codeforces are download-only problem sources. Their
URLs are accepted by `download` and the other URL-driven commands, but neither
is part of the login registry above: there is no session to check, and
submissions are not automated yet.

ShareOJ is in the login registry: `neoj login shareoj` performs the same
headless email + password login as the platform's own CLI, including the MFA
and new-password challenges, and stores the access and refresh tokens it
issues. Submissions go through the official API, so no session cookies are
involved. Accounts that were created through Google must set a password on the
website before the CLI can log in.

## Terminology

This documentation says **platform**. The CLI mixes that word with **service** in
places: `logout` takes `--service`, and `status` describes itself in terms of
services. Both refer to the same registry entry.

## Boundaries

Platform code owns HTTP requests, HTML parsing, and URL validation. Commands own
argument handling and presentation. Keeping those apart is what lets a new
platform reuse the existing file, template, and credential logic without
touching it.

The platform code lives in [`packages/api`](https://github.com/e6nlaq/neoj/tree/main/packages/api)
and is published as `@neoj/api`, so other tools can use the same clients without
installing the CLI. The package never reads or writes credential files; the CLI
loads a saved session, passes it to a client, and decides what to store. See
[`packages/api/README.md`](https://github.com/e6nlaq/neoj/blob/main/packages/api/README.md)
for the public entry points.

## Related

- [Log in, check status, and log out](../how-to/manage-sessions.md)
- [CLI reference](../reference/cli.md)
