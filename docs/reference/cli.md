# CLI reference

## Commands

| Command                                               | Description                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `neoj init [--force]`                                 | Copy the bundled templates into the current project.                        |
| `neoj download <url>` (alias: `neoj d`)               | Download a problem's sample tests into the test-case directory.             |
| `neoj login <platform>`                               | Log in to a platform. The supported names are `atcoder` and `yukicoder`.    |
| `neoj logout [--service <name...>]`                   | Log out of the given platforms, or of every platform when no name is given. |
| `neoj status [--offline]`                             | Show the login status of every supported platform.                          |
| `neoj stash [save\|list\|apply\|pop\|drop\|clear]`    | Save and restore the working files of the current problem.                  |
| `neoj completions <shell>` (alias: `neoj completion`) | Print a completion script for bash, zsh, fish, or PowerShell.               |

### `init`

| Option          | Description               |
| --------------- | ------------------------- |
| `-f`, `--force` | Overwrite existing files. |

Writes to the directory containing the nearest `neoj.toml`, or to the current
directory when none is found. The search stops at the repository root.

### `download`

| Argument | Description                          |
| -------- | ------------------------------------ |
| `<url>`  | An AtCoder or yukicoder problem URL. |

Requires an initialized project. See
[Download sample tests](../how-to/download-samples.md).

### `login`

| Argument     | Description                              |
| ------------ | ---------------------------------------- |
| `<platform>` | Platform name: `atcoder` or `yukicoder`. |

For yukicoder, `--method` selects the credential type:

| Option              | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `--method <method>` | `token` (default, browser device flow) or `api-key` (profile key). |

See [Log in, check status, and log out](../how-to/manage-sessions.md).

### `logout`

| Option                | Description                                         |
| --------------------- | --------------------------------------------------- |
| `--service <name...>` | Platforms to log out of. Omit it to log out of all. |

### `status`

| Option      | Description                                             |
| ----------- | ------------------------------------------------------- |
| `--offline` | Use saved credentials without contacting the platforms. |

### `stash`

| Subcommand       | Description                                                 |
| ---------------- | ----------------------------------------------------------- |
| `save` (default) | Save `src` and the test-case directory.                     |
| `list`           | List saved stashes; the current problem is marked with `*`. |
| `apply`          | Restore the current problem's stash.                        |
| `pop`            | Restore the current problem's stash and remove it.          |
| `drop`           | Remove the current problem's stash.                         |
| `clear`          | Remove every stash.                                         |

`neoj stash` without a subcommand is the same as `neoj stash save`.

| Option          | Command | Description                          |
| --------------- | ------- | ------------------------------------ |
| `-f`, `--force` | `save`  | Replace an existing stash.           |
| `-f`, `--force` | `clear` | Required; deletes every saved stash. |

Every subcommand except `list` and `clear` works on the problem recorded in
`.neoj/problem.json`, so run `neoj download <url>` first. `apply` restores the
saved files and removes other files inside the saved directories, so the
directories match the stash exactly. See
[Stash and restore work per problem](../how-to/stash-work.md).

### `completions`

| Argument  | Description                                                                |
| --------- | -------------------------------------------------------------------------- |
| `<shell>` | Shell to generate completions for: `bash`, `zsh`, `fish`, or `powershell`. |

Writes the script to standard output. See
[Set up shell completions](../how-to/setup-completions.md) for installation
examples. PowerShell completion requires `pwsh` 7.2 or later.

## Global options

| Option            | Description       |
| ----------------- | ----------------- |
| `-h`, `--help`    | Show help.        |
| `-V`, `--version` | Show the version. |

## Files

| Path                 | Description                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `<testcase.folder>/` | Sample inputs and outputs; `test/` by default.                                                              |
| `.neoj/problem.json` | URL of the last successful download. AtCoder also stores its contest window; yukicoder stores only the URL. |
| `.neoj/stash/`       | Per-problem snapshots of `src` and the test-case directory.                                                 |
| `neoj.toml`          | Project configuration.                                                                                      |
| `~/.neoj.toml`       | Global configuration.                                                                                       |

`neoj` does not download or update `neoj.toml`; it only reads it. See the
[configuration reference](configuration.md) for keys and defaults.

## Exit status

`neoj` exits with `0` after a successful command and `1` when a command reports
an error. Partial failures, such as an unreadable template file, also set `1`.
