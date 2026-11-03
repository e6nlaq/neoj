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
first:

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
✓ sample-1      12 ms  AC
✗ sample-2      14 ms  WA (line 3)
  - 3 7
  + 3 8
? sample-3       9 ms  UNJUDGED (expected output missing)
    42

3 case(s): 1 passed, 1 failed, 1 unjudged (38 ms).
```

| Verdict    | Meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `AC`       | The output matched.                                                           |
| `WA`       | The output differed; every line is printed with the differing ones colored.   |
| `TLE`      | The time limit was exceeded and the program was stopped.                      |
| `MLE`      | The peak memory usage exceeded the limit (checked after the run).             |
| `RE`       | The program exited with a non-zero status, was killed, or flooded the output. |
| `UNJUDGED` | There is no `.out` file; the program still ran and its output is shown.       |

Wide terminals show both outputs side by side; narrow terminals, tabs, and long
lines fall back to a stacked list.

## Compare leniently

Two options loosen the comparison for one run:

```bash
neoj test -S    # ignore whitespace at the end of each line
neoj test -N    # ignore newlines at the end of the output
```

Set `test.ignore_trailing_space` or `test.ignore_trailing_newline` to make the
behavior the default. Whitespace inside a line is always significant, and CRLF
is normalized automatically.

## Run selected cases

```bash
neoj test -f sample-1 sample-3
```

The names are the file names without `.in`, and they must match exactly. Unknown
names are reported with the available cases.

## Limits

- `test.timeout` defaults to 10 seconds. `neoj test -t 2` or
  `languages.<key>.timeout` changes it.
- `test.memory` defaults to 1024 MiB. The limit is judged from the peak resident
  memory of the program process after it exits; a program that spawns children
  is measured for the direct child only.
- Standard output and standard error are each capped at 8 MiB. A program that
  exceeds the cap is stopped and reported as `RE`.

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
fast. Delete the directory whenever you want to start clean.

`neoj test --cache` and `neoj test --no-cache` override the setting for one run,
and `--no-cache` removes that run's build directory when it finishes.

## Exit status

`0` when every case passed, `2` when at least one case failed, and `1` when
`neoj` could not compile or read the configuration.

## Related

- [Configure a project](configure-project.md)
- [Download sample tests](download-samples.md)
- [Configuration reference](../reference/configuration.md)
- [CLI reference](../reference/cli.md)
