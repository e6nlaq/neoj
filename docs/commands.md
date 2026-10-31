# Commands

| Command                                                         | Description                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `neoj init [--force]`                                           | Copy the bundled templates into the current project.                       |
| [`neoj download <url>`](#neoj-download-url) (`neoj d`)          | Download a problem's sample tests into the test-case directory.            |
| [`neoj login <platform>`](platforms.md#logging-in)              | Log in to a platform, such as `atcoder`.                                   |
| [`neoj logout [--service <name...>]`](platforms.md#signing-out) | Log out of the given services, or of every service when no name is given.  |
| [`neoj status [--offline]`](platforms.md#checking-status)       | Show the login status of every platform. `--offline` skips network checks. |

## `neoj init`

The command searches upward from the current directory for a `neoj.toml`. When
one is found, the templates are written next to it; otherwise the current
directory is used. Existing files are skipped unless `--force` is given.

The search stops at the repository root (the nearest directory containing
`.git`), so configuration never leaks in from outside the repository.

## `neoj download <url>`

The command requires an initialized project with a `neoj.toml` file. It uses the
nearest project config as the project root; if none is found, run `neoj init`
first. The problem is fetched through the platform integration that matches the
URL. When a problem returns 404 and the platform reports the user as logged out,
the error suggests logging in first (for AtCoder, `neoj login atcoder`).

After a successful download, the command records the problem URL and contest
start/end times in `.neoj/problem.json`. This file is managed by `neoj` and is
replaced on each successful download; the `.neoj` directory is ignored by Git.

Sample files are written according to the [`[testcase]` settings](configuration.md#test-cases).
