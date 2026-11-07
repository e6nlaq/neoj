# Build and run the sample tests

```bash
neoj test
neoj test src/main.cpp
neoj t                       # alias
```

`neoj test` compiles the solution, runs it against every sample downloaded into
the test-case directory, and compares the output with the matching `.out` file.

## Before you run it

The command needs a project with a `neoj.toml`, a `[languages.<key>]` section,
and at least one `*.in` file in the test-case directory. Download the samples
first (interactive mode can run a single session without any `*.in` file):

```bash
neoj init
neoj d https://atcoder.jp/contests/abc300/tasks/abc300_a
```

## Configure a language

Each `[languages.<key>]` section describes one language. The key is any name you
like; `neoj` uses it in messages and for cache entries.

```toml
[test]
source = "src/main.cpp"

[languages.cpp]
source = "src/**/*.cpp"
compile = ["g++", "-std=c++23", "-O2", "-o", "{outfile}", "{source}"]
run = ["{outfile}"]
```

- `source` is a glob (or a list of globs) that marks which files belong to the
  language. `neoj test` matches the source file against these globs and uses the
  one language that matches.
- `compile` is optional. Omit it for interpreted languages, for example
  `run = ["python3", "{source}"]`.
- `run` receives the test input on standard input and runs from the project root.

Arguments are passed to the program directly; no shell is involved, so quotes
and redirections do not work inside the arrays. Write `["sh", "-c", "…"]` when
you really need a shell.

### Placeholders

| Placeholder | Value                                                     |
| ----------- | --------------------------------------------------------- |
| `{source}`  | Absolute path of the source file.                         |
| `{outfile}` | Absolute path of the built program, without an extension. |
| `{outdir}`  | Directory that holds `{outfile}` and other build output.  |
| `{dir}`     | Project root.                                             |
| `{testdir}` | Absolute path of the test-case directory.                 |

`compile` must use `{outfile}` or `{outdir}`, so the built program can be
checked and cached. On Windows, `{outfile}` resolves to `<outfile>.exe` when
that file exists, because some compilers add the extension themselves.

## Choose the source file

`neoj test` uses the `[source]` argument when you pass one, otherwise
`test.source`. The path must exist and must be a file inside the project; globs
are not accepted here. The file is then matched against the `source` globs of
every language, and exactly one language must match. When several match, pass
`--language`:

```bash
neoj test --language cpp
```

### Save a name for a source file

Register a short name in `[alias]` and pass it instead of the path:

```toml
[alias]
main = "src/main.cpp"
old = "archive/2019/a.cpp"
```

```bash
neoj test main     # builds src/main.cpp
neoj t old         # builds archive/2019/a.cpp
```

The target is resolved from the project root, so the same alias works from a
subdirectory. An alias wins if a file with that name also exists (`neoj test
./main` reaches the file), an alias cannot point at another alias, and
`test.source` is never expanded. An unknown name is reported with the aliases
you have defined.

## What a run does

1. Resolves the source file and its language.
2. Compiles once, unless a cached build is still valid.
3. Runs every test case, in parallel by default.
4. Prints a report in name order, regardless of completion order.

The progress bar is drawn on standard error. When the output is not a terminal
or you pass `--no-progress`, the bar is skipped and only the final report is
written.

## Read the report

```text
✓ sample-1      45 ms    28 MiB  AC
✗ sample-2      37 ms    28 MiB  WA (line 2)
    Line │ Input
       1 │ 1 2
       2 │ 3

    Line │ Expected │ Output
       1 │ 3 7      │ 3 7
       2 │ 1        │ 1 8

    stderr:
      warning: 'x' is unused
? sample-3      36 ms    28 MiB  UNJUDGED (expected output missing)
    Line │ Input
       1 │ 4

    Line │ Output
       1 │ 42

3 case(s): 1 passed, 1 failed, 1 unjudged (68 ms; slowest 45 ms, peak 28 MiB).
```

| Verdict    | Meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `AC`       | The output matched.                                                           |
| `WA`       | The output differed; every line is printed with the differing ones colored.   |
| `TLE`      | The time limit was exceeded and the program was stopped.                      |
| `MLE`      | The peak memory usage exceeded the limit (checked after the run).             |
| `RE`       | The program exited with a non-zero status, was killed, or flooded the output. |
| `UNJUDGED` | There is no `.out` file; the program still ran and its output is shown.       |

Each case line shows how long it ran and the peak memory it used, after the
name. Memory is measured for the direct child process and shown as `? MiB` when
the platform does not report it. The final line repeats the whole run's elapsed
time, the slowest case, and the highest peak memory.

A `MLE` case reports only the limit it crossed, such as `MLE (> 1024 MiB)`,
because the memory column already holds the measured value.

Every failure shows the input that produced it, then the expected and actual
output; a case without an `.out` file shows the program's output instead. `-v`
adds the same tables to passing cases.

Wide terminals show both outputs side by side in one table; narrow terminals,
tabs, and long lines fall back to two stacked tables that keep their headers.

A case that did not pass is separated from the next one by two blank lines.

## Test an interactive problem

Some problems require your program to talk to a judge instead of reading all of
the input at once. `neoj test --interactive` (or `-i`) starts your solution and
an interactor at the same time and connects them with pipes:

```text
test/sample-1.in ──▶ interactor (path passed with {infile})
interactor stdout ──▶ solution stdin
solution stdout   ──▶ interactor stdin
```

Describe the interactor in `neoj.toml`:

```toml
[test.interactor]
source = "src/interactor.cpp"
run = ["{outfile}", "{infile}"]
```

- `source` is required. It is a plain path relative to the project root.
- `compile` and `run` default to the `[languages.<key>]` entry whose `source`
  glob matches the interactor file, so a C++ interactor needs only `run` here to
  receive `{infile}`.
- `{infile}` expands to the path of the case's `.in` file. It is available in
  `run` only; standard input belongs to the solution's output.
- The interactor decides the verdict: exit status `0` is `AC`, and anything else
  is `WA`. Its first non-empty stderr line becomes the `WA (...)` reason.
- Your solution's own failures win: `TLE`, `MLE`, `RE`, and the output cap are
  reported even if the interactor would have accepted the answer.
- `.out` files are ignored. When the directory has no `*.in` file, one session
  runs without `{infile}`, for interactors that generate their own input.
- Both programs must flush every line they write, or the other side waits
  forever. In C++ use `std::endl` or `std::cout.flush()`; in Python use
  `flush=True` or `sys.stdout.flush()`.
- `test.interactor.timeout` (default 15 seconds) caps the whole session; the
  solution's own limit is still `test.timeout` / `-t`.

The report replaces the input and output tables with the conversation:

```text
✗ sample-1     41 ms    12 MiB  WA (wrong answer: 3 != 7)
    interactive:
      J> 1 2
      S> 3
      J> 5
      S> 8
    interactor stderr:
      wrong answer: 3 != 7
```

`J>` marks a line from the interactor to the solution and `S>` a line from the
solution to the interactor. Failures show the transcript; `-v` shows it for `AC`
too. `test.display_lines` limits how many lines are printed.

## Number and trim the lines

The `Line` column numbers the rows of every table. It is on by default; set
`test.show_line_numbers = false` or pass `--no-show-line-numbers` to drop it.

Blocks longer than `test.display_lines` (default `30`) are cut off with
`… N more line(s)`, so one large case cannot flood the report. The comparison is
the exception: it always lists every line. The limit covers the input, the
program's output, and the verbose tables for passing cases.

```toml
[test]
show_line_numbers = true
display_lines = 30
```

## Show the program's standard error

The program's standard error is printed after each case that wrote something,
regardless of the verdict:

```text
✓ sample-1      12 ms    28 MiB  AC
    stderr:
      warning: 'x' is unused
```

Lines are reproduced as written: no color, no truncation, and only if the
program wrote at least one byte. Choose how much is printed with
`test.show_stderr`:

```toml
[test]
show_stderr = "failure"   # "always" (default), "failure", or "never"
```

- `"always"` prints standard error for every case.
- `"failure"` prints it only when a case did not pass.
- `"never"` never prints it.

`neoj test --show-stderr failure` overrides the setting for one run.

## Compare leniently

Two options loosen the comparison for one run:

```bash
neoj test -S    # ignore whitespace at the end of each line
neoj test -N    # ignore newlines at the end of the output
```

Set `test.ignore_trailing_space` or `test.ignore_trailing_newline` to make the
behavior the default. Whitespace inside a line is always significant, and CRLF
is normalized automatically.

## Judge floating-point output

When a problem accepts answers with a small numeric error, pass `-e`. It turns
the tolerance on; the exponent selects its size:

```bash
neoj test -e       # 10^-6 (the default)
neoj test -e 9     # 10^-9
```

A token matches when

```text
|actual - expected| <= 10^-exponent * max(1, |expected|)
```

so the same rule accepts an absolute error near zero and a relative error for
larger values. Numeric tokens are compared as numbers even when they are
written differently (`1e-7` and `0.0000001` match, and so do `1` and `1.0`).
`NaN`, `Infinity`, and hexadecimal spellings are compared as text.

With `-e`, the whole output is split on ASCII whitespace, so line breaks and
runs of spaces do not matter; only the token order and values do. `-S` and `-N`
have no additional effect.

Set `test.error` to change the default exponent used when `-e` has no argument:

```toml
[test]
error = 9
```

A numeric difference outside the tolerance is reported with both values:

```text
✗ sample-1     45 ms    28 MiB  WA (line 1: 0 vs 0.000002)
```

The option is ignored with `--interactive`, because the interactor decides the
verdict; `neoj` prints a warning when both are given.

## Run selected cases

```bash
neoj test -f sample-1 sample-3
```

The names are the file names without `.in`, and they must match exactly. Unknown
names are reported with the available cases.

## Add a case by hand

When the samples do not cover a case you want to check, create one from the
terminal:

```bash
neoj handmade
```

Type the input, finish it with a blank line, then type the expected output and
finish it the same way. The files are written only after both blocks are
complete. See [Create a test case by hand](create-handmade-tests.md).

## Limits

- `test.timeout` defaults to 10 seconds. `neoj test -t 2` or
  `languages.<key>.timeout` changes it. In interactive mode it limits the
  solution process, while `test.interactor.timeout` (default 15 seconds) limits
  the whole session.
- `test.memory` defaults to 1024 MiB. The limit is judged from the peak resident
  memory of the program process after it exits; a program that spawns children
  is measured for the direct child only. Interactive mode applies it to the
  solution only, never to the interactor.
- Standard output and standard error are each capped at 8 MiB. A program that
  exceeds the cap is stopped and reported as `RE`. Interactive mode applies the
  cap to both programs.

## Cache compiled programs

Set `test.cache = true` to reuse a build:

```toml
[test]
cache = true

[languages.cpp]
cache_files = ["src/**/*.hpp"]
```

The cache key covers the language, the compile command, the source contents,
`cache_files`, and the platform. Each key gets its own directory under
`.neoj/build/`; older entries are kept, so switching between two solutions stays
fast. `neoj prune` deletes every cached build, and `neoj prune --dry-run` reports
the count and size first.

`neoj test --cache` and `neoj test --no-cache` override the setting for one run,
and `--no-cache` removes that run's build directory when it finishes.

## Exit status

`0` when every case passed, `2` when at least one case failed, and `1` when
`neoj` could not compile or read the configuration.

## Related

- [Run a solution without tests](run-a-solution.md)
- [Configure a project](configure-project.md)
- [Download sample tests](download-samples.md)
- [Create a test case by hand](create-handmade-tests.md)
- [Configuration reference](../reference/configuration.md)
- [CLI reference](../reference/cli.md)
