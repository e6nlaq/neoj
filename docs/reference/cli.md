# CLI reference

## Commands

| Command                                                    | Description                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `neoj init [--force]`                                      | Copy the bundled templates into the current project.                        |
| `neoj download <url>` (alias: `neoj d`)                    | Download a problem's sample tests into the test-case directory.             |
| `neoj open [options]` (alias: `neoj o`)                    | Open the current problem in the browser.                                    |
| `neoj handmade` (alias: `neoj h`)                          | Create a handmade test case from interactive input.                         |
| `neoj generate` (alias: `neoj g`)                          | Create random test cases with a generator and a naive solution.             |
| `neoj login <platform>`                                    | Log in to a platform. The supported names are `atcoder` and `yukicoder`.    |
| `neoj logout [--service <name...>]`                        | Log out of the given platforms, or of every platform when no name is given. |
| `neoj status [--offline]`                                  | Show the login status of every supported platform.                          |
| `neoj stash [save\|list\|apply\|pop\|drop\|clear]`         | Save and restore the working files of the current problem.                  |
| `neoj test [source]` (alias: `neoj t`)                     | Build the solution and run it against the sample tests.                     |
| `neoj run [source] [args...]` (alias: `neoj r`)            | Build the solution and run it without tests, forwarding `args`.             |
| `neoj submit [source]` (aliases: `neoj s`, `neoj submits`) | Submit the solution for the current problem.                                |
| `neoj languages [platform]` (alias: `neoj langs`)          | List the language IDs a platform accepts.                                   |
| `neoj prune [--dry-run]`                                   | Remove every cached build under `.neoj/build/`.                             |
| `neoj completions <shell>` (alias: `neoj completion`)      | Print a completion script for bash, zsh, fish, or PowerShell.               |

### `init`

| Option          | Description               |
| --------------- | ------------------------- |
| `-f`, `--force` | Overwrite existing files. |

Writes to the directory containing the nearest `neoj.toml`, or to the current
directory when none is found. The search stops at the repository root.

### `download`

| Argument | Description                                                                   |
| -------- | ----------------------------------------------------------------------------- |
| `<url>`  | An AtCoder, yukicoder, Aizu Online Judge, Codeforces, or ShareOJ problem URL. |

Requires an initialized project. See
[Download sample tests](../how-to/download-samples.md).

### `open`

Opens the page for the problem recorded by the last successful download, so run
`neoj download <url>` first.

| Option                | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `-c`, `--contest`     | Open the contest page of the current problem.        |
| `-s`, `--submissions` | Open your own submissions for the current problem.   |
| `--clip`              | Copy the URL to the clipboard instead of opening it. |
| `--url`               | Print the URL instead of opening it.                 |

`--contest` and `--submissions` cannot be combined, and neither can `--clip` and
`--url`.

| Target          | AtCoder                                                                  | yukicoder                                                                                                                        |
| --------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| (default)       | The problem page.                                                        | The problem page.                                                                                                                |
| `--contest`     | `https://atcoder.jp/contests/<contestId>`                                | The contest that published the problem, resolved through the public API.                                                         |
| `--submissions` | `https://atcoder.jp/contests/<contestId>/submissions/me?f.Task=<taskId>` | The problem's own submissions page (`/problems/no/<n>/submissions` or `/problems/<id>/submissions`) with `my_submission=enabled` |

AtCoder URLs are derived from the problem URL. yukicoder does not record the
contest in the problem URL, so `--contest` asks the public API; it needs network
access, and a problem that belongs to no contest cannot be opened this way. When
a problem appears in several contests, the API reports only one of them.

AOJ and ShareOJ problems support only the default target: `--contest` and
`--submissions` report that they are not supported for them yet. For
Codeforces, only `--submissions` is unsupported.

If the browser cannot be started, the URL is printed so it can be opened by
hand and the command exits with `1`.

`--url` prints only the URL to standard output, so it can be used in scripts.
`--clip` copies the URL and prints the result; when the clipboard is unavailable
the command reports the URL on standard error and exits with `1`.

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
there are removed by the next download. The directory must not be `src` or
`.neoj`, and it must not contain or live inside `src`.

### `generate`

Creates random test cases by pairing two programs: the generator in
`generate.gen` prints a test case's input, and the naive solution in
`generate.naive` turns that input into the expected output. Both are built like
a solution, with the language detected from `[languages.<key>]`.

```text
$ neoj generate
✔ Compiled judge/gen.ts (generate.gen) in 0.12 s.
✔ Compiled judge/naive.ts (generate.naive) in 0.10 s.
✔ Created 2 test case(s): random-1, random-2.
```

The generator runs with the case number as its first argument, so a failing case
is reproducible: `random-7` came out of `judge/gen.cpp 7`. The generator's
standard input is closed immediately; its standard output becomes the `.in`
file, which is piped to the naive solution's standard input, whose standard
output becomes the `.out` file. Empty inputs and outputs are written as they
are, and neither program's output is otherwise reformatted.

Cases are written into the test-case directory with the next free case numbers,
so existing cases are never replaced. Files are only written after both parts of
a case are complete, and Ctrl-C kills the running programs and removes the
partially written cases. A tool that exits with a non-zero status, times out
after `generate.timeout` seconds, or floods the output cap stops the whole run;
the cases completed before the failure stay on disk.

| Option                         | Description                                                |
| ------------------------------ | ---------------------------------------------------------- |
| `-i`, `--input`                | Only create `.in` files; `generate.naive` is not needed.   |
| `-c`, `--count <count>`        | Number of cases to create (default: `generate.count`).     |
| `-J`, `--jobs <count>`         | Number of cases to generate at once.                       |
| `--no-parallel`                | Generate one case at a time.                               |
| `--cache` / `--no-cache`       | Keep or delete the compiled programs under `.neoj/build/`. |
| `--progress` / `--no-progress` | Draw or hide the progress bar.                             |

See [Generate random test cases](../how-to/generate-random-tests.md).

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

Runs every `*.in` file in the test-case directory against the built program. With
`--interactive`, the interactor named by `[test.interactor]` judges each case
instead of comparing the output with `*.out`. With `--judge`, the checker named
by `[test.judge]` receives the solution's output and decides the verdict.

With `-s`/`--submit`, a run in which every executed case passed continues into
`neoj submit` with the same source and language. The submission follows the
normal `neoj submit` behavior: the preview, the confirmation prompt, the
presubmit command, and the `submit.*` settings all apply unchanged. When any
case fails, nothing is submitted and `neoj test` still exits with the usual
status. A failed submission is reported as an error, so the exit status is `1`.

| Option                                           | Description                                                  |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `-l`, `--language <key>`                         | Use this `[languages.<key>]` entry instead of detecting one. |
| `-J`, `--jobs <count>`                           | Number of test cases to run at once.                         |
| `--no-parallel`                                  | Run one test case at a time.                                 |
| `-t`, `--timeout <seconds>`                      | Time limit per test case.                                    |
| `-m`, `--memory <MiB>`                           | Memory limit per test case.                                  |
| `-f`, `--filter <name...>`                       | Run only the named cases (`sample-1` for `sample-1.in`).     |
| `-i`, `--interactive`                            | Judge with the interactor in `[test.interactor]`.            |
| `-j`, `--judge`                                  | Judge with the checker in `[test.judge]`.                    |
| `-e`, `--error [exponent]`                       | Accept floating-point errors up to `10^-exponent`.           |
| `--cache` / `--no-cache`                         | Keep or delete the compiled program under `.neoj/build/`.    |
| `-S`, `--ignore-trailing-space`                  | Ignore trailing whitespace on each line.                     |
| `-N`, `--ignore-trailing-newline`                | Ignore newlines at the end of the output.                    |
| `--show-stderr <mode>`                           | Print the program's stderr: `always`, `failure`, or `never`. |
| `--progress` / `--no-progress`                   | Draw or hide the progress bar.                               |
| `--show-line-numbers` / `--no-show-line-numbers` | Number the rows of the input and output tables.              |
| `-v`, `--verbose`                                | Print input and output for passing cases too.                |
| `-s`, `--submit`                                 | Submit the solution when every test case passes.             |

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

### `submit`

| Argument   | Description                                                                      |
| ---------- | -------------------------------------------------------------------------------- |
| `[source]` | Source file to submit. An `[alias]` name is accepted. Defaults to `test.source`. |

Submits the solution to the problem recorded in `.neoj/problem.json`, so run
`neoj download <url>` first. The source is resolved like `neoj test`: an `[alias]`
name, a path, or `test.source`; `-l`, `--language <key>` chooses among several
matching `[languages.<key>]` entries. The file is not compiled before submission.

| Option                           | Description                                                  |
| -------------------------------- | ------------------------------------------------------------ |
| `-l`, `--language <key>`         | Use this `[languages.<key>]` entry instead of detecting one. |
| `-p`, `--platform-language <id>` | Submit as this platform language ID.                         |
| `--yes`                          | Skip the confirmation prompt. The wait still runs.           |
| `--wait <seconds>`               | Override `submit.wait` for one run.                          |
| `--no-wait`                      | Submit immediately, as if `--wait 0` were given.             |
| `--no-presubmit`                 | Submit the source file without running `presubmit`.          |
| `--dry-run`                      | Show the preview without contacting the platform.            |
| `--open` / `--no-open`           | Open or do not open the submission page afterwards.          |

The command runs these steps in order: the language's `presubmit` command, a
preview, the confirmation prompt (default **No**), the wait, and the submission.

The preview shows the first and last `submit.preview_lines` lines with their real
line numbers and `...` between them; a file with at most `2 * preview_lines`
lines is shown in full. The line numbers are dimmed when standard output is a
terminal and `NO_COLOR` is unset, like `neoj test`. The preview and the size are
printed for `--yes` and `--dry-run` too, so a script can still inspect what
would be sent.

Before submitting, `neoj` runs `languages.<key>.presubmit` in the project root
when it is configured. `{source}` is the absolute path of the original file and
`{outfile}` is a temporary file that keeps the source extension; write the text
to submit there, or print it to standard output when the command does not use
`{outfile}`. The original file is never modified, and the temporary directory is
removed afterwards. A failing command reports its standard error and exits with
`1`, and so does an empty result. The default time limit is
`submit.presubmit_timeout` (30 seconds).

When no platform session is valid, `neoj submit` starts the login flow if
`login.auto_login` is `true` (the default). Cancelling the login exits with `0`;
a failed login exits with `1`. The platform language ID comes from
`--platform-language`, then `languages.<key>.submit.<platform>`. When neither is
set, the command lists the available language IDs and exits with `1` instead of
prompting.

After a successful submission, the command prints the submission ID and URL and
opens the submission page in the browser unless `--no-open` or
`submit.open = false` is set. A browser that cannot be started only produces a
warning, and the command still exits with `0`. `submit.clip` copies the submitted
text to the clipboard: `"never"` (default), `"always"` (before submitting, while
still submitting), or `"fail"` (only when submitting fails, which still exits
with `1`).

`--dry-run` performs no network request, login, language-ID lookup, or clipboard
copy; it runs the presubmit command and prints the preview and size. It cannot be
combined with `--platform-language`, and it ignores `--wait`, `--no-wait`,
`--open`, `--no-open`, and `--yes`.

Submission automation depends on the platform. AtCoder shows warnings for Daily
Training contests (`adt_...`), outside the contest window recorded by `neoj
download`, and when the submit page contains a Turnstile challenge. If AtCoder
rejects the request, the error tells you to open the submit page in your browser.
yukicoder submissions use the same API as the web form. See
[Submit a solution](../how-to/submit-solution.md).

### `languages`

| Argument     | Description                                                               |
| ------------ | ------------------------------------------------------------------------- |
| `[platform]` | Platform name: `atcoder` or `yukicoder`. Defaults to the current problem. |

Prints the language IDs that `--platform-language` and
`languages.<key>.submit.<platform>` accept. The table lists each ID with the
language name, and a `*` marks every ID already configured for that platform.
The closing line names the `neoj.toml` keys that set those IDs, or explains how
to configure one when none is set.

| Option            | Description                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| `--filter <text>` | Show only languages whose ID, name, or runtime matches this text, ignoring case. |

When `[platform]` is omitted, the platform recorded in `.neoj/problem.json` is
used; without a recorded problem the command asks for a platform instead.
`yukicoder` needs no login. `atcoder` requires a session and follows
`login.auto_login`: cancelling the login exits with `0`, and a failed login
exits with `1`. Without a recorded AtCoder problem, the command queries contest
`abc100` and labels it as a fallback in the header, because the language list
is the same across contests.

See [Submit a solution](../how-to/submit-solution.md) for how the IDs are used.

### `prune`

Removes every cached build under `.neoj/build/`, so the next `neoj test` or
`neoj run` compiles from scratch. The nearest initialized project is used, and
`.neoj/problem.json`, saved stashes, and the test-case directory are left
untouched.

| Option      | Description                                     |
| ----------- | ----------------------------------------------- |
| `--dry-run` | Report the cached builds without deleting them. |

The command reports the number of cached builds and their total size. It runs
without confirmation because the cache can be rebuilt, and it succeeds with
`No cached builds.` when there is nothing to remove.

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

| Path                 | Description                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `<testcase.folder>/` | Sample and handmade inputs and outputs; `test/` by default.                                                                        |
| `.neoj/build/`       | Compiled programs, one directory per cache key when `test.cache` is enabled; shared by `test` and `run`. Delete with `neoj prune`. |
| `.neoj/problem.json` | URL of the last successful download. AtCoder also stores its contest window; yukicoder stores only the URL.                        |
| `.neoj/stash/`       | Per-problem snapshots of `src` and the test-case directory.                                                                        |
| `neoj.toml`          | Project configuration.                                                                                                             |
| `~/.neoj.toml`       | Global configuration.                                                                                                              |

`neoj` does not download or update `neoj.toml`; it only reads it. See the
[configuration reference](configuration.md) for keys and defaults.

## Exit status

`neoj` exits with `0` after a successful command and `1` when a command reports
an error. Partial failures, such as an unreadable template file, also set `1`.
`neoj handmade` sets `1` when it is cancelled before both blocks are complete.

`neoj generate` sets `1` for configuration, compile, and tool failures, and
`130` when Ctrl-C interrupts it; the cases completed before the interruption
stay on disk.

`neoj test` uses three values: `0` when every case passed, `1` for a compile,
configuration, or environment error, and `2` when at least one case failed
(`WA`, `TLE`, `MLE`, or `RE`). Cases without an expected output are reported as
`UNJUDGED` and do not change the exit status.

`neoj run` exits with the program's own exit code. A configuration, compile, or
start error sets `1`, and a program killed by a signal also sets `1` after a
one-line notice (hidden by `--silent`).

`neoj submit` exits with `0` after a successful submission and when the
confirmation or the login is cancelled. Configuration, presubmit, network, and
platform errors set `1`.

`neoj languages` exits with `0` after printing the list and when the login is
cancelled. An unsupported platform, a missing problem when no platform is given,
and network or authentication errors set `1`.
