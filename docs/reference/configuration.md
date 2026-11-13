# Configuration reference

`neoj` reads `~/.neoj.toml` and the nearest project `neoj.toml`, merges them, and
validates the result against a strict schema. Unknown keys are errors. The merge
is table by table: a key set in the project file replaces the same key from the
global file, and every other key is kept.

Each key may only be set in the scope listed below. Setting `src` or any
`[template]` key in the global file is an error.

Editors can complete these keys when the file points at the published schema;
see [Set up editor completions](../how-to/setup-editor-completions.md).

## Keys

### `src`

| Type        | Default | Scope   |
| ----------- | ------- | ------- |
| string path | none    | project |

Destination directory for the solution template, resolved from the project root.
It is required when `template.enable = true`, must stay inside the project, must
not pass through a symbolic link, must not target `.git` or `.neoj`, and must
not overlap `template.folder`.

### `alias.<name>`

| Type        | Default | Scope             |
| ----------- | ------- | ----------------- |
| string path | none    | global or project |

An extra name that `neoj test` accepts instead of a source path:

```toml
[alias]
main = "src/main.cpp"
old = "archive/2019/a.cpp"
```

`neoj test main` then builds `src/main.cpp`. Each alias is one name mapped to one
path:

- The target is always resolved from the project root, so an alias works from
  any subdirectory.
- The target must exist, be a regular file, and stay inside the project. An
  alias cannot point at another alias.
- An alias wins when the same name is also a file; use `./main` to test that
  file.
- Only the positional argument of `neoj test` is matched against aliases.
  `test.source` is always a literal path.
- Names must be non-empty and must not be `.`, `..`, or contain `/` or `\`.
- Matching is exact and case-sensitive. Identical names in the global and
  project files resolve to the project value.

### `login.open_browser`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `true`  | global or project |

Open the browser automatically during the yukicoder CLI-token device flow. The
command always prints the verification URL and code, so login still works when
this is `false` or when the browser cannot be opened (for example over SSH).

### `login.auto_login`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `true`  | global or project |

Start the platform login flow automatically when `neoj submit` finds no valid
session. Cancelling the flow exits with `0`. With `false`, the command fails
instead and tells you to run `neoj login <platform>`.

### `testcase.folder`

| Type        | Default | Scope             |
| ----------- | ------- | ----------------- |
| string path | `test`  | global or project |

Directory that receives downloaded samples and handmade test cases. The path is
resolved from the project root (the directory containing the nearest
`neoj.toml`). It must stay inside the project, must not pass through a symbolic
link, and must not target `.git` or `.neoj`. It must also not overlap `src`:
neither directory may contain the other.

Each download replaces the whole directory, so files placed there by hand are
removed.

### `testcase.filename`

| Type   | Default     | Scope             |
| ------ | ----------- | ----------------- |
| string | `sample-{}` | global or project |

Base name for each sample file. It must contain exactly one `{}`, which is
replaced by the 1-based sample number, and must be a valid file name: no
`<>:"/\|?*` characters and no control characters.

Sample `n` is written as `<name>.in` and `<name>.out`, so the default produces
`sample-1.in`, `sample-1.out`, and so on.

### `handmade.filename`

| Type   | Default       | Scope             |
| ------ | ------------- | ----------------- |
| string | `handmade-{}` | global or project |

Base name for test cases created by `neoj handmade`. It follows the same rules as
`testcase.filename`: exactly one `{}` replaced by the 1-based case number, and a
valid file name. Case `n` is written as `<name>.in` and `<name>.out` in
`testcase.folder`.

The number is the smallest one whose `.in` and `.out` files do not exist yet, so
a new case never replaces an existing one. Handmade cases live in the same
directory as downloaded samples and are removed when `neoj download` replaces
that directory.

### `generate.gen`

| Type   | Default | Scope             |
| ------ | ------- | ----------------- |
| string | —       | global or project |

Source file of the generator used by `neoj generate`, relative to the project
root. The generator is built and detected like a solution, and runs with the
case number as its first argument; its standard output becomes the new case's
`.in` file.

### `generate.naive`

| Type   | Default | Scope             |
| ------ | ------- | ----------------- |
| string | —       | global or project |

Source file of the naive solution used by `neoj generate`, relative to the
project root. It receives a generated input on standard input, and its standard
output becomes the case's `.out` file. Required unless `neoj generate --input`
only creates inputs.

### `generate.filename`

| Type   | Default     | Scope             |
| ------ | ----------- | ----------------- |
| string | `random-{}` | global or project |

Base name for test cases created by `neoj generate`. It follows the same rules
as `testcase.filename`: exactly one `{}` replaced by the 1-based case number,
and a valid file name. The number is the smallest one whose `.in` and `.out`
files do not exist yet, so a generated case never replaces an existing one,
including an input-only case.

### `generate.count`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| integer | `1`     | global or project |

Number of test cases `neoj generate` creates per run. `--count` overrides it.

### `generate.timeout`

| Type   | Default | Scope             |
| ------ | ------- | ----------------- |
| number | `10`    | global or project |

Time limit in seconds for each run of the generator and of the naive solution.
A tool that exceeds it stops the run.

### `generate.parallel`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `true`  | global or project |

Generate test cases in parallel. `--no-parallel` runs one case at a time.

### `download.show_sample`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `false` | global or project |

Print every downloaded sample's input and output after the files have been
written successfully. When it is `false`, `download` only reports the number of
samples and the destination directory.

### `test.source`

| Type        | Default | Scope             |
| ----------- | ------- | ----------------- |
| string path | none    | global or project |

Source file that `neoj test` builds when no source is passed on the command line.
It is resolved from the project root and must be a plain path that exists; globs
are rejected. `neoj test <source>` overrides it for one run.

### `test.interactor.source`

| Type        | Default | Scope             |
| ----------- | ------- | ----------------- |
| string path | none    | global or project |

Interactor file used by `neoj test --interactive`. It is resolved from the
project root and must be a plain path that exists. The section is only read when
`--interactive` is passed, so a project without an interactor keeps working.

```toml
[test.interactor]
source = "src/interactor.cpp"
run = ["{outfile}", "{infile}"]
```

### `test.interactor.compile`

| Type            | Default                            | Scope             |
| --------------- | ---------------------------------- | ----------------- |
| array of string | matching `languages.<key>.compile` | global or project |

Command and arguments that build the interactor. When it is omitted, `neoj`
picks the `[languages.<key>]` whose `source` glob matches the interactor file
and reuses its `compile`. If several languages match, set `compile` and `run`
here to choose one. The command must reference `{outfile}` or `{outdir}`, as
with a language `compile`.

### `test.interactor.run`

| Type            | Default                        | Scope             |
| --------------- | ------------------------------ | ----------------- |
| array of string | matching `languages.<key>.run` | global or project |

Command and arguments that run the interactor. In addition to the placeholders
listed in [Build and run the sample tests](../how-to/run-tests.md#placeholders),
`{infile}` expands to the test case's `.in` path. `{infile}` is not available in
`compile`, because the path changes per case.

### `test.interactor.timeout`

| Type             | Default | Scope             |
| ---------------- | ------- | ----------------- |
| number (seconds) | `15`    | global or project |

Wall-clock limit for one interactive session. When it expires, both the
solution and the interactor are stopped and the case is reported as `TLE`. The
solution's own `test.timeout` still applies and can stop it earlier.

### `test.judge.source`

| Type        | Default | Scope             |
| ----------- | ------- | ----------------- |
| string path | none    | global or project |

Checker file used by `neoj test --judge`. It is resolved from the project root
and must be a plain path that exists. The section is only read when `--judge` is
passed, so a project without a checker keeps working.

```toml
[test.judge]
source = "src/checker.cpp"
run = ["{outfile}", "{infile}"]
```

### `test.judge.compile`

| Type            | Default                            | Scope             |
| --------------- | ---------------------------------- | ----------------- |
| array of string | matching `languages.<key>.compile` | global or project |

Command and arguments that build the checker. When it is omitted, `neoj` picks
the `[languages.<key>]` whose `source` glob matches the checker file and reuses
its `compile`. If several languages match, set `compile` and `run` here to
choose one. The command must reference `{outfile}` or `{outdir}`, as with a
language `compile`.

### `test.judge.run`

| Type            | Default                        | Scope             |
| --------------- | ------------------------------ | ----------------- |
| array of string | matching `languages.<key>.run` | global or project |

Command and arguments that run the checker. The solution's standard output is
written to the checker's standard input. In addition to the placeholders listed
in [Build and run the sample tests](../how-to/run-tests.md#placeholders),
`{infile}` expands to the test case's `.in` path when the checker needs the
input. `{infile}` is optional, and it is not available in `compile` because the
path changes per case.

### `test.judge.timeout`

| Type             | Default | Scope             |
| ---------------- | ------- | ----------------- |
| number (seconds) | `10`    | global or project |

Wall-clock limit for one checker run. When it expires, the checker is stopped
and the case is reported as `TLE`. The solution's own `test.timeout` applies
separately and can stop it before the checker starts. The checker has no memory
limit.

### `test.timeout`

| Type             | Default | Scope             |
| ---------------- | ------- | ----------------- |
| number (seconds) | `10`    | global or project |

Wall-clock limit for each test case, measured from process start to exit. The
value may be fractional. `languages.<key>.timeout` overrides it per language and
`--timeout` overrides both.

### `test.memory`

| Type             | Default | Scope             |
| ---------------- | ------- | ----------------- |
| number (integer) | `1024`  | global or project |

Memory limit in MiB. The limit is checked after the program exits, using the peak
resident set size of the direct child process, so a program is not stopped while
it runs. Grandchildren, such as the interpreter started by a script, are not
counted.

### `test.parallel`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `true`  | global or project |

Run test cases in parallel. The default number of jobs is the smaller of the
logical CPU count and the number of cases; `--jobs` and `--no-parallel` override
it. The final report always lists cases in name order.

### `test.cache`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `false` | global or project |

Keep the compiled program under `.neoj/build/<hash>/` and skip compiling when the
same source, commands, and extra inputs are unchanged. With `false`, the build
directory for the run is deleted afterwards. `--cache` and `--no-cache` override
it for one run.

### `test.error`

| Type               | Default | Scope             |
| ------------------ | ------- | ----------------- |
| integer (`0`–`15`) | `6`     | global or project |

Exponent of the floating-point tolerance used by `neoj test --error`. `-e`
turns the tolerance on, and this value is the default when the option has no
argument. `-e 9` overrides it for one run. The comparison accepts a token when
`|actual - expected| <= 10^-error * max(1, |expected|)`.

### `test.ignore_trailing_space`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `false` | global or project |

Ignore whitespace at the end of each output line when comparing. Whitespace
inside a line is still significant. `-S` enables it for one run.

### `test.ignore_trailing_newline`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `false` | global or project |

Ignore missing or extra newlines at the end of the output when comparing. `-N`
enables it for one run.

### `test.show_stderr`

| Type   | Default    | Scope             |
| ------ | ---------- | ----------------- |
| string | `"always"` | global or project |

Print the program's standard error in the report after the run. The value is one
of:

- `"always"` — print standard error for every case, including passing ones.
- `"failure"` — print it only for cases that did not pass (`WA`, `TLE`, `MLE`,
  `RE`, or `UNJUDGED`).
- `"never"` — never print it.

Lines are printed as captured, without color and without a line limit, under a
`stderr:` label. `--show-stderr <mode>` overrides the setting for one run.

### `test.display_lines`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| integer | `30`    | global or project |

Lines shown per block in the report before the rest is summarised as
`… N more line(s)`. It applies to the input and to the program's output; a `WA`
comparison always lists every line so the difference stays visible. Must be at
least `1`.

### `test.show_line_numbers`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `true`  | global or project |

Prefix each row of the report's input and output tables with its line number. The
comparison adds the number once per row, next to `Expected` and `Output`.
`--no-show-line-numbers` turns it off for one run.

### `run.silent`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `false` | global or project |

Hide `neoj run`'s informational logs, such as `Compiled src/main.cpp (languages.cpp) in 41 ms.`
and the cache-reuse line. Compiler diagnostics and every error message are still
printed to standard error. `--silent` turns it on for one run; options must come
before the source file, so `neoj run src/main.cpp --silent` forwards `--silent`
to the program instead.

The same logs are hidden automatically when standard error is not a terminal, so
`neoj run > out.txt 2>&1` and scripts that capture the output stay quiet.

### `submit.confirm`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `true`  | global or project |

Ask for confirmation before submitting. The prompt defaults to **No**.
`--yes` skips the prompt for one run but keeps the wait.

### `submit.wait`

| Type             | Default | Scope             |
| ---------------- | ------- | ----------------- |
| number (seconds) | `3`     | global or project |

Time to wait after the confirmation and before contacting the platform, so a
last check is still possible. On a terminal the command draws a countdown bar on
standard error; otherwise it prints one line. `--wait <seconds>` and `--no-wait`
override it for one run, and `--yes` does not skip the wait.

### `submit.open`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `true`  | global or project |

Open the submission page in the browser after a successful submission.
`--open` and `--no-open` override it for one run. A browser that cannot be
started only produces a warning, and the command still succeeds.

### `submit.clip`

| Type   | Default   | Scope             |
| ------ | --------- | ----------------- |
| string | `"never"` | global or project |

When `neoj submit` copies the submitted text to the clipboard:

- `"never"` — never copy it.
- `"always"` — copy it after the presubmit command, then submit anyway. A
  clipboard that is unavailable only produces a warning.
- `"fail"` — copy it only when the submission fails, so it can be pasted into the
  browser. The command still exits with `1`.

There is no command-line flag for this setting.

### `submit.preview_lines`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| integer | `5`     | global or project |

Number of lines shown at the start and at the end of the submission preview, with
the real line numbers and `...` between the two blocks. A file with at most
`2 * preview_lines` lines is shown in full.

### `submit.presubmit_timeout`

| Type             | Default | Scope             |
| ---------------- | ------- | ----------------- |
| number (seconds) | `30`    | global or project |

Wall-clock limit for `languages.<key>.presubmit`. When it expires, neoj stops the
command and reports that the presubmit timed out.

### `submit.check_limit`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `true`  | global or project |

Refuse to submit a source that exceeds the platform's documented size limit:
512 KiB for AtCoder, and 128 KiB for yukicoder and ShareOJ. The size is the
UTF-8 size of the text that would be sent, after `presubmit`. Set it to `false`
to keep working when a platform changes its limit before `neoj` does;
`neoj submit --ignore-limit` does the same for one run.

### `languages.<key>.source`

| Type                  | Default  | Scope             |
| --------------------- | -------- | ----------------- |
| string or string list | required | global or project |

Glob or globs, relative to the project root, that identify files written in this
language. `neoj test` matches the resolved source file against these globs to pick
the language; exactly one language must match unless `--language` is given.
Absolute patterns and `..` segments are rejected.

### `languages.<key>.compile`

| Type            | Default | Scope             |
| --------------- | ------- | ----------------- |
| list of strings | none    | global or project |

Command and arguments that build the source. It must reference `{outfile}` or
`{outdir}`. Omit it for interpreted languages.

### `languages.<key>.run`

| Type            | Default  | Scope             |
| --------------- | -------- | ----------------- |
| list of strings | required | global or project |

Command and arguments that run the built program. It receives the test input on
standard input.

### `languages.<key>.timeout`

| Type             | Default        | Scope             |
| ---------------- | -------------- | ----------------- |
| number (seconds) | `test.timeout` | global or project |

Time limit for this language.

### `languages.<key>.memory`

| Type             | Default       | Scope             |
| ---------------- | ------------- | ----------------- |
| number (integer) | `test.memory` | global or project |

Memory limit for this language, in MiB.

### `languages.<key>.cache_files`

| Type                  | Default | Scope             |
| --------------------- | ------- | ----------------- |
| string or string list | none    | global or project |

Extra files, such as shared headers, whose contents belong in the compile cache
key. They are not passed to the compiler; they only invalidate the cache when
they change.

### `languages.<key>.presubmit`

| Type            | Default | Scope             |
| --------------- | ------- | ----------------- |
| list of strings | none    | global or project |

Command and arguments that turn the source into the text `neoj submit` sends. It
runs in the project root with the same environment plus `NEOJ_PLATFORM`,
`NEOJ_PROBLEM_URL`, and `NEOJ_LANGUAGE`. The original file is never modified.

| Placeholder | Value                                                         |
| ----------- | ------------------------------------------------------------- |
| `{source}`  | Absolute path of the original source file.                    |
| `{outfile}` | Temporary output path that keeps the source file's extension. |
| `{outdir}`  | Directory holding `{outfile}` and other temporary output.     |
| `{dir}`     | Project root.                                                 |

Write the submission text to `{outfile}`. When the command does not reference
`{outfile}`, its standard output is submitted instead; either way, an empty
result is an error. `--no-presubmit` skips the command for one run.

```toml
[languages.cpp]
source = "src/**/*.cpp"
compile = ["g++", "-std=c++23", "-O2", "-o", "{outfile}", "{source}"]
run = ["{outfile}"]
presubmit = ["python", "tools/expand.py", "{source}", "{outfile}"]
submit = { atcoder = "5001", yukicoder = "5001" }
```

### `languages.<key>.submit`

| Type                   | Default | Scope             |
| ---------------------- | ------- | ----------------- |
| table of string values | none    | global or project |

Platform language IDs for this language, keyed by platform name. `neoj submit`
uses `submit.atcoder` for AtCoder and `submit.yukicoder` for yukicoder, and
`submit.shareoj` for ShareOJ (a runtime ID from `neoj languages shareoj`).
`--platform-language <id>` overrides the value for one run. When the key is
missing, the command lists the platform's available IDs and exits with `1`
instead of prompting.

### Placeholders in `compile` and `run`

| Placeholder | Value                                                     |
| ----------- | --------------------------------------------------------- |
| `{source}`  | Absolute path of the source file.                         |
| `{outfile}` | Absolute path of the built program, without an extension. |
| `{outdir}`  | Directory holding `{outfile}` and other build output.     |
| `{dir}`     | Project root.                                             |
| `{testdir}` | Absolute path of the test-case directory.                 |

Placeholders are replaced inside each argument. Unknown placeholders are a
configuration error. On Windows, a `{outfile}` that does not exist is replaced by
`{outfile}.exe` when that file exists, because some compilers add the extension
themselves.

### `stash.auto_stash`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `false` | global or project |

Save the working files of the current problem before `download` replaces the
test-case directory. `neoj` only writes the stash when the downloaded problem
differs from the URL in `.neoj/problem.json`. The snapshot contains `src` when it
is configured, plus `testcase.folder`.

### `stash.auto_apply`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `false` | global or project |

After a download that changes the problem, restore the new problem's stash when
one exists. The stash is kept, so downloading another problem and coming back
restores it again.

### `stash.force`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `true`  | global or project |

Allow `neoj stash save` to replace an existing stash of the same problem. When it
is `false`, `save` fails until you pass `--force`. `stash.auto_stash` always
refreshes the stash, and `neoj stash clear` always requires `--force`.

### `template.enable`

| Type    | Default | Scope   |
| ------- | ------- | ------- |
| boolean | `false` | project |

Apply the template to `src` after a download that changes the problem. Enabling
it requires both `src` and `template.folder`. Downloading the same problem again
refreshes the samples without reapplying the template.

### `template.folder`

| Type        | Default | Scope   |
| ----------- | ------- | ------- |
| string path | none    | project |

Directory holding the template files, resolved from the project root. It must
exist when `template.enable = true`; an empty directory is allowed. The path
must stay inside the project, must not target `.git` or `.neoj`, must not
overlap `src`, and the tree must not contain symbolic links. Hidden files are
copied like any other file.

### `template.exclude`

| Type          | Default | Scope   |
| ------------- | ------- | ------- |
| array of glob | `[]`    | project |

Globs for files in `template.folder` that must not be copied into `src`. A
pattern is matched against the path relative to `template.folder` and against the
entry name, so `*.md` also excludes Markdown files inside subdirectories. A
matching directory is skipped with its contents. Use `**/` explicitly when a
pattern should only match a nested path.

### `template.mode`

| Type                   | Default   | Scope   |
| ---------------------- | --------- | ------- |
| `overlay` or `replace` | `overlay` | project |

How the template is applied to `src`:

- `overlay` copies the template over `src`, replacing files that exist in both
  places and keeping everything else.
- `replace` removes the contents of `src` before copying the template.

### `update.enabled`

| Type    | Default | Scope             |
| ------- | ------- | ----------------- |
| boolean | `true`  | global or project |

Show an update notification at the end of each command when a newer version is
available. The notification prints one line on standard error, so piping a
command's output is unaffected:

```text
ℹ  Update available: 0.0.8 → 0.0.9. Run: npm install -g @neoj/cli@latest
```

The check is skipped entirely for `neoj completions` and `neoj --version`. When
the registry cannot be reached, `neoj` stays silent and never reports the check
as an error.

### `update.interval`

| Type   | Default  | Scope             |
| ------ | -------- | ----------------- |
| number | `259200` | global or project |

Minimum seconds between update checks against the npm registry; the default is
3 days. The last successful check is cached in neoj's data directory and reused
between checks, so most commands run without any network access. Within the
interval, the cached version still drives the notification, so an available
update is announced on every command until neoj is updated. `0` checks on every
command.

## Example

```toml
src = "src"

[alias]
main = "src/main.cpp"
old = "archive/2019/a.cpp"

[login]
open_browser = true
auto_login = true

[testcase]
folder = "test"
filename = "sample-{}"

[handmade]
filename = "handmade-{}"

[generate]
gen = "judge/gen.cpp"
naive = "judge/naive.cpp"
filename = "random-{}"
count = 1
timeout = 10
parallel = true

[test]
source = "src/main.cpp"
timeout = 10
memory = 1024
parallel = true
cache = false
ignore_trailing_space = false
ignore_trailing_newline = false
show_stderr = "always"

[run]
silent = false

[submit]
confirm = true
wait = 3
open = true
clip = "never"
preview_lines = 5
presubmit_timeout = 30
check_limit = true

[languages.cpp]
source = "src/**/*.cpp"
compile = ["g++", "-std=c++23", "-O2", "-o", "{outfile}", "{source}"]
run = ["{outfile}"]
timeout = 10
memory = 1024
cache_files = ["src/**/*.hpp"]
presubmit = ["python", "tools/expand.py", "{source}", "{outfile}"]
submit = { atcoder = "5001", yukicoder = "5001" }

[download]
show_sample = false

[stash]
auto_stash = false
auto_apply = false
force = true

[template]
enable = false
folder = "template"
exclude = ["*.md", "generated/**"]
mode = "overlay"
```

## Validation errors

When the merged configuration fails validation, `neoj` reports the paths of the
files it read, then each invalid key with the reason and the received value's
type. Values themselves are not printed.
