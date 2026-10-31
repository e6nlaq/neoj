# neoj

`neoj` is a command-line tool for competitive programming workflows, built with
[Bun](https://bun.com) and TypeScript. It aims to be a modern alternative to `oj`:
a clear CLI, a reliable problem workflow, and room to grow into multiple contest
platforms. AtCoder is the first supported platform.

> **Status: early development.** Commands, configuration, and output formats may
> change between releases.

## Features

- Log in to AtCoder with your `REVEL_SESSION` cookie and verify the session
  before it is saved.
- Report the login status of every supported platform, with an `--offline` mode
  for environments without network access.
- Scaffold a project from the bundled templates.
- Download AtCoder sample tests into the configured test-case directory.
- Remove saved credentials for a single platform or all of them.

## Requirements

- [Bun](https://bun.com) 1.4 or newer

## Installation

`neoj` is not published to npm yet, so install it from source:

```bash
git clone https://github.com/e6nlaq/neoj.git
cd neoj
bun install
```

Run the CLI from the repository:

```bash
bun run neoj --help
```

## Quick start

```bash
# Copy the project templates into the current directory
bun run neoj init

# Download AtCoder samples
bun run neoj d https://atcoder.jp/contests/abc300/tasks/abc300_a

# Save an AtCoder session
bun run neoj login atcoder

# Check that the saved session is still valid
bun run neoj status
```

## Commands

| Command                             | Description                                                                |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `neoj init [--force]`               | Copy the bundled templates into the current project.                       |
| `neoj download <url>` (`neoj d`)    | Replace the test-case directory with samples from an AtCoder problem.      |
| `neoj login <platform>`             | Log in to a platform. Currently supported: `atcoder`.                      |
| `neoj logout [--service <name...>]` | Log out of the given services, or of every service when no name is given.  |
| `neoj status [--offline]`           | Show the login status of every platform. `--offline` skips network checks. |

### `neoj init`

The command searches upward from the current directory for a `neoj.toml`. When
one is found, the templates are written next to it; otherwise the current
directory is used. Existing files are skipped unless `--force` is given.

The search stops at the repository root (the nearest directory containing
`.git`), so configuration never leaks in from outside the repository.

### `neoj login atcoder`

1. Open `https://atcoder.jp`, then copy the `REVEL_SESSION` cookie value from your
   browser's DevTools (Application → Cookies).
2. Paste the value into the prompt. Either the raw value or `REVEL_SESSION=...`
   is accepted.
3. The session is verified against AtCoder before it is saved.

> Treat the session cookie like a password: it grants access to your AtCoder
> account. Never share it or commit it to a repository.

### `neoj status --offline`

The normal `status` command contacts each platform to check whether the saved
session is still valid. With `--offline`, `neoj` only reads the saved credentials
and reports `Logged in (offline, not verified)` instead.

### `neoj download <url>`

The command requires an initialized project with a `neoj.toml` file. It uses the
nearest project config as the project root; if none is found, run `neoj init`
first. When a problem returns 404 while AtCoder reports the user as logged out,
the error suggests trying `neoj login atcoder`.

## Configuration

`neoj` reads TOML configuration from two locations and merges them, with the
project file taking precedence over the global file:

| Scope   | Path                                                                                    |
| ------- | --------------------------------------------------------------------------------------- |
| Global  | `~/.neoj.toml`                                                                          |
| Project | `neoj.toml` in the current directory or the nearest ancestor, up to the repository root |

Configure downloaded test cases with a `[testcase]` table. Relative folders are
resolved from the directory containing the nearest project `neoj.toml` (or the
current directory when there is no project config), and must remain inside that
directory. Project settings override global settings.

```toml
[testcase]
folder = "test"             # default
filename = "sample-{}"      # default; {} is replaced by the 1-based sample number

[download]
show_sample = false         # print downloaded input/output samples after success
```

Each sample is written as `<filename>.in` and `<filename>.out`. For example,
the default creates `sample-1.in` and `sample-1.out`. Downloading replaces the
configured folder without prompting; a failed problem fetch leaves existing
tests untouched. Set `download.show_sample = true` to print each sample's input
and output after the files have been written successfully.

If configuration does not match the schema, `neoj` lists every invalid key,
the reason, and the received value's type along with the config file paths.
Values themselves are not printed.

## Authentication data

Saved credentials live in the per-user data directory chosen by
[`env-paths`](https://github.com/sindresorhus/env-paths):

| Platform | Path                                                  |
| -------- | ----------------------------------------------------- |
| Linux    | `~/.local/share/neoj-nodejs/auth.json`                |
| macOS    | `~/Library/Application Support/neoj-nodejs/auth.json` |
| Windows  | `%LOCALAPPDATA%\neoj-nodejs\Data\auth.json`           |

On POSIX systems the file is written with `0600` permissions. Writes are atomic,
so an interrupted run cannot truncate the existing credentials, and
`neoj logout` deletes the file once no providers remain.

## Development

```bash
bun install
bun test           # unit tests
bun run format     # format the code
bun run lint       # lint with Oxlint
bun run typecheck  # type-check with TypeScript
bun run build      # bundle the CLI into dist/
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). The
pre-commit hook runs formatting, linting, and type checking.

## License

[MIT](LICENSE)
