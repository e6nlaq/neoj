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
| `neoj test [source]` (alias: `neoj t`)                | Build the solution and run it against the sample tests.                     |
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

### `test`

| Argument   | Description                                     |
| ---------- | ----------------------------------------------- |
| `[source]` | Source file to test. Defaults to `test.source`. |

Runs every `*.in` file in the test-case directory against the built program.

| Option                            | Description                                                  |
| --------------------------------- | ------------------------------------------------------------ |
| `-l`, `--language <key>`          | Use this `[languages.<key>]` entry instead of detecting one. |
| `-j`, `--jobs <count>`            | Number of test cases to run at once.                         |
| `--no-parallel`                   | Run one test case at a time.                                 |
| `-t`, `--timeout <seconds>`       | Time limit per test case.                                    |
| `-m`, `--memory <MiB>`            | Memory limit per test case.                                  |
| `-f`, `--filter <name...>`        | Run only the named cases (`sample-1` for `sample-1.in`).     |
| `--cache` / `--no-cache`          | Keep or delete the compiled program under `.neoj/build/`.    |
| `-S`, `--ignore-trailing-space`   | Ignore trailing whitespace on each line.                     |
| `-N`, `--ignore-trailing-newline` | Ignore newlines at the end of the output.                    |
| `--show-stderr <mode>`            | Print the program's stderr: `always`, `failure`, or `never`. |
| `--progress` / `--no-progress`    | Draw or hide the progress bar.                               |
| `-v`, `--verbose`                 | Print input and output for passing cases too.                |

See [Build and run the sample tests](../how-to/run-tests.md).

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
| `.neoj/build/`       | Compiled programs, one directory per cache key when `test.cache` is enabled.                                |
| `.neoj/problem.json` | URL of the last successful download. AtCoder also stores its contest window; yukicoder stores only the URL. |
| `.neoj/stash/`       | Per-problem snapshots of `src` and the test-case directory.                                                 |
| `neoj.toml`          | Project configuration.                                                                                      |
| `~/.neoj.toml`       | Global configuration.                                                                                       |

`neoj` does not download or update `neoj.toml`; it only reads it. See the
[configuration reference](configuration.md) for keys and defaults.

## Exit status

`neoj` exits with `0` after a successful command and `1` when a command reports
an error. Partial failures, such as an unreadable template file, also set `1`.

`neoj test` uses three values: `0` when every case passed, `1` for a compile,
configuration, or environment error, and `2` when at least one case failed
(`WA`, `TLE`, `MLE`, or `RE`). Cases without an expected output are reported as
`UNJUDGED` and do not change the exit status.
