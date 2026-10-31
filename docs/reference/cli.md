# CLI reference

## Commands

| Command                                 | Description                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `neoj init [--force]`                   | Copy the bundled templates into the current project.                        |
| `neoj download <url>` (alias: `neoj d`) | Download a problem's sample tests into the test-case directory.             |
| `neoj login <platform>`                 | Log in to a platform. The supported name is `atcoder`.                      |
| `neoj logout [--service <name...>]`     | Log out of the given platforms, or of every platform when no name is given. |
| `neoj status [--offline]`               | Show the login status of every supported platform.                          |

### `init`

| Option          | Description               |
| --------------- | ------------------------- |
| `-f`, `--force` | Overwrite existing files. |

Writes to the directory containing the nearest `neoj.toml`, or to the current
directory when none is found. The search stops at the repository root.

### `download`

| Argument | Description                  |
| -------- | ---------------------------- |
| `<url>`  | An AtCoder contest task URL. |

Requires an initialized project. See
[Download sample tests](../how-to/download-samples.md).

### `login`

| Argument     | Description                                     |
| ------------ | ----------------------------------------------- |
| `<platform>` | Platform name. The supported name is `atcoder`. |

See [Log in, check status, and log out](../how-to/manage-sessions.md).

### `logout`

| Option                | Description                                         |
| --------------------- | --------------------------------------------------- |
| `--service <name...>` | Platforms to log out of. Omit it to log out of all. |

### `status`

| Option      | Description                                             |
| ----------- | ------------------------------------------------------- |
| `--offline` | Use saved credentials without contacting the platforms. |

## Global options

| Option            | Description       |
| ----------------- | ----------------- |
| `-h`, `--help`    | Show help.        |
| `-V`, `--version` | Show the version. |

## Files

| Path                 | Description                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `<testcase.folder>/` | Sample inputs and outputs; `test/` by default.                                                           |
| `.neoj/problem.json` | URL and contest window of the last successful download, as ISO 8601 instants. Replaced on each download. |
| `neoj.toml`          | Project configuration.                                                                                   |
| `~/.neoj.toml`       | Global configuration.                                                                                    |

`neoj` does not download or update `neoj.toml`; it only reads it. See the
[configuration reference](configuration.md) for keys and defaults.

## Exit status

`neoj` exits with `0` after a successful command and `1` when a command reports
an error. Partial failures, such as an unreadable template file, also set `1`.
