# CLI reference

## Commands

| Command                                               | Description                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `neoj init [--force]`                                 | Copy the bundled templates into the current project.                        |
| `neoj download <url>` (alias: `neoj d`)               | Download a problem's sample tests into the test-case directory.             |
| `neoj open [options]` (alias: `neoj o`)               | Open the current problem in the browser.                                    |
| `neoj handmade` (alias: `neoj h`)                     | Create a handmade test case from interactive input.                         |
| `neoj login <platform>`                               | Log in to a platform. The supported names are `atcoder` and `yukicoder`.    |
| `neoj logout [--service <name...>]`                   | Log out of the given platforms, or of every platform when no name is given. |
| `neoj status [--offline]`                             | Show the login status of every supported platform.                          |
| `neoj stash [save\|list\|apply\|pop\|drop\|clear]`    | Save and restore the working files of the current problem.                  |
| `neoj test [source]` (alias: `neoj t`)                | Build the solution and run it against the sample tests.                     |
| `neoj run [source] [args...]` (alias: `neoj r`)       | Build the solution and run it without tests, forwarding `args`.             |
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

### `open`

Opens the page for the problem recorded by the last successful download, so run
`neoj download <url>` first.

| Option                | Description                                        |
| --------------------- | -------------------------------------------------- |
| `-c`, `--contest`     | Open the contest page of the current problem.      |
| `-s`, `--submissions` | Open your own submissions for the current problem. |

`--contest` and `--submissions` cannot be combined.

| Target          | AtCoder                                                                  | yukicoder                                                                |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| (default)       | The problem page.                                                        | The problem page.                                                        |
| `--contest`     | `https://atcoder.jp/contests/<contestId>`                                | The contest that published the problem, resolved through the public API. |
| `--submissions` | `https://atcoder.jp/contests/<contestId>/submissions/me?f.Task=<taskId>` | `https://yukicoder.me/problems/no/<n>/submissions?my_submission=enabled` |

AtCoder URLs are derived from the problem URL. yukicoder does not record the
contest in the problem URL, so `--contest` asks the public API; it needs network
access, and a problem that belongs to no contest cannot be opened this way. When
a problem appears in several contests, the API reports only one of them.

If the browser cannot be started, the URL is printed so it can be opened by
hand and the command exits with `1`.

### `handmade`

Reads one test case from the terminal and writes it into the test-case directory:

```text
$ neoj handmade
test/handmade-1.in and test/handmade-1.out will be created.
input> 1 2
input>

output> 3
output>
✔ Created test/handmade-1.in and test/handmade-1.out.
```

Enter the input line by line and finish the block with a blank line, then do the
same for the expected output; a blank line separates the two blocks. Both files
are written only after the output block has been closed, so an interrupted
session leaves no files behind. Ctrl-C, or Ctrl-D (Ctrl-Z on Windows), cancels
the command without writing.

The command takes the next free case number, so existing cases are never
replaced. The directory comes from `testcase.folder` and the file names from
`handmade.filename` (default `handmade-{}`). It needs an interactive terminal and
an initialized project. See
[Create a test case by hand](../how-to/create-handmade-tests.md).

`neoj download` replaces the whole test-case directory, so handmade files placed
there are removed by the next download.

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

| Argument   | Description                                                                    |
| ---------- | ------------------------------------------------------------------------------ |
| `[source]` | Source file to test. An `[alias]` name is accepted. Defaults to `test.source`. |

Runs every `*.in` file in the test-case directory against the built program.

| Option                                           | Description                                                  |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `-l`, `--language <key>`                         | Use this `[languages.<key>]` entry instead of detecting one. |
| `-j`, `--jobs <count>`                           | Number of test cases to run at once.                         |
| `--no-parallel`                                  | Run one test case at a time.                                 |
| `-t`, `--timeout <seconds>`                      | Time limit per test case.                                    |
| `-m`, `--memory <MiB>`                           | Memory limit per test case.                                  |
| `-f`, `--filter <name...>`                       | Run only the named cases (`sample-1` for `sample-1.in`).     |
| `--cache` / `--no-cache`                         | Keep or delete the compiled program under `.neoj/build/`.    |
| `-S`, `--ignore-trailing-space`                  | Ignore trailing whitespace on each line.                     |
| `-N`, `--ignore-trailing-newline`                | Ignore newlines at the end of the output.                    |
| `--show-stderr <mode>`                           | Print the program's stderr: `always`, `failure`, or `never`. |
| `--progress` / `--no-progress`                   | Draw or hide the progress bar.                               |
| `--show-line-numbers` / `--no-show-line-numbers` | Number the rows of the input and output tables.              |
| `-v`, `--verbose`                                | Print input and output for passing cases too.                |

See [Build and run the sample tests](../how-to/run-tests.md).

### `run`

| Argument    | Description                                                                   |
| ----------- | ----------------------------------------------------------------------------- |
| `[source]`  | Source file to run. An `[alias]` name is accepted. Defaults to `test.source`. |
| `[args...]` | Arguments passed to the program verbatim.                                     |

Builds the source and runs it with the terminal attached: standard input,
output, and error belong to the program, and no time limit, memory limit, or
output cap is applied. The test-case directory is not read, so `neoj run` works
without `test/`.

| Option                   | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `-l`, `--language <key>` | Use this `[languages.<key>]` entry instead of detecting one. |
| `--cache` / `--no-cache` | Keep or delete the compiled program under `.neoj/build/`.    |
| `--silent`               | Hide informational logs such as `Compiled ... in N ms.`.     |

Everything after the source goes to the program, so `neoj` options must come
first. `--` before the source keeps `test.source` and forwards everything after
it:

```bash
neoj run src/main.cpp -x 1       # -x 1 goes to the program
neoj run -l cpp -- -x 1          # test.source + -x 1
neoj run --silent src/main.cpp   # neoj parses --silent
neoj run src/main.cpp --silent   # --silent goes to the program
```

`--silent` only hides informational logs. The compiler's own diagnostics and
every error message are still printed to standard error. Informational logs are
also hidden automatically when standard error is not a terminal, so piped or
redirected output stays clean. See
[Run a solution without tests](../how-to/run-a-solution.md).

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
| `<testcase.folder>/` | Sample and handmade inputs and outputs; `test/` by default.                                                 |
| `.neoj/build/`       | Compiled programs, one directory per cache key when `test.cache` is enabled; shared by `test` and `run`.    |
| `.neoj/problem.json` | URL of the last successful download. AtCoder also stores its contest window; yukicoder stores only the URL. |
| `.neoj/stash/`       | Per-problem snapshots of `src` and the test-case directory.                                                 |
| `neoj.toml`          | Project configuration.                                                                                      |
| `~/.neoj.toml`       | Global configuration.                                                                                       |

`neoj` does not download or update `neoj.toml`; it only reads it. See the
[configuration reference](configuration.md) for keys and defaults.

## Exit status

`neoj` exits with `0` after a successful command and `1` when a command reports
an error. Partial failures, such as an unreadable template file, also set `1`.
`neoj handmade` sets `1` when it is cancelled before both blocks are complete.

`neoj test` uses three values: `0` when every case passed, `1` for a compile,
configuration, or environment error, and `2` when at least one case failed
(`WA`, `TLE`, `MLE`, or `RE`). Cases without an expected output are reported as
`UNJUDGED` and do not change the exit status.

`neoj run` exits with the program's own exit code. A configuration, compile, or
start error sets `1`, and a program killed by a signal also sets `1` after a
one-line notice (hidden by `--silent`).
