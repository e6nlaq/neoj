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

AtCoder is the registered platform today, which is why the examples use it.

## Terminology

This documentation says **platform**. The CLI mixes that word with **service** in
places: `logout` takes `--service`, and `status` describes itself in terms of
services. Both refer to the same registry entry.

## Boundaries

Platform code owns HTTP requests, HTML parsing, and URL validation. Commands own
argument handling and presentation. Keeping those apart is what lets a new
platform reuse the existing file, template, and credential logic without
touching it.

## Related

- [Log in, check status, and log out](../how-to/manage-sessions.md)
- [CLI reference](../reference/cli.md)
