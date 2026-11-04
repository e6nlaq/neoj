# Run a solution without tests

```bash
neoj run
neoj run src/main.cpp
neoj r                        # alias
```

`neoj run` builds the solution and starts it with the terminal attached. It does
not read the test-case directory, compare output, or apply any limit, so it is
the quick way to try a program by hand or to pass your own arguments.

## Before you run it

You need a project with a `neoj.toml` and a `[languages.<key>]` section; the
same one `neoj test` uses:

```toml
[test]
source = "src/main.cpp"

[languages.cpp]
source = "src/**/*.cpp"
compile = ["g++", "-std=c++23", "-O2", "-o", "{outfile}", "{source}"]
run = ["{outfile}"]
```

Downloaded samples are not required. `neoj run` works when `test/` does not
exist, and it never opens an `.in` or `.out` file.

## Type input and see output

The program's standard input, output, and error are connected directly to your
terminal. neoj does not capture, decorate, or truncate them:

```bash
neoj run
1 2
3
```

Interactive programs, colors, and Ctrl-C behave as if you started the program
yourself. There is no time limit, no memory limit, and no 8 MiB output cap.

neoj's own logs go to standard error, so standard output stays clean:

```text
Compiled src/main.cpp (languages.cpp) in 412 ms.
```

## Pass arguments to the program

Everything after the source file is forwarded verbatim:

```bash
neoj run src/main.cpp 5 7
neoj run src/main.cpp --fast -x 1
```

neoj options must therefore come before the source file:

```bash
neoj run --cache src/main.cpp 5 7
neoj run --silent src/main.cpp
```

To use `test.source` and still pass arguments, put `--` before them:

```bash
neoj run -- 5 7
neoj run -l cpp -- -x 1
```

The first `--` is a separator: everything after it goes to the program. A second
`--` is forwarded.

## Choose the source file

The source is resolved exactly like `neoj test`: the `[source]` argument, an
`[alias]` name, or `test.source`, matched against the language `source` globs.
`-l`, `--language <key>` selects the language when several match.

```toml
[alias]
main = "src/main.cpp"
```

```bash
neoj r main
```

See [Build and run the sample tests](run-tests.md#choose-the-source-file) for the
resolution rules.

## Quiet the build log

`--silent` hides informational logs such as the compile result and the cache
reuse line:

```bash
neoj run --silent src/main.cpp
```

Set it permanently in the configuration:

```toml
[run]
silent = true
```

Errors are never hidden: the compiler's diagnostics, a compile failure, and a
missing source file are always printed.

## Cache builds

`neoj run` shares `test.cache` and the `.neoj/build/` directory with
`neoj test`, so a build made by one command is reused by the other. Override the
setting for one run with `--cache` or `--no-cache`; `--no-cache` deletes that
run's build directory when the program exits.

## Exit status

`neoj run` exits with the program's own exit code, so scripts can check it
directly. A configuration, compile, or start error sets `1`. A program killed by
a signal also sets `1`, with a one-line notice unless `--silent` is set.

## Related

- [Build and run the sample tests](run-tests.md)
- [Configure a project](configure-project.md)
- [Configuration reference](../reference/configuration.md)
- [CLI reference](../reference/cli.md)
