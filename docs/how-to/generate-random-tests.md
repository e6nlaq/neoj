English | [日本語](../ja/generate-random-tests.md)

# Generate random test cases

`neoj generate` creates random test cases by pairing two programs:

- the **generator** (`generate.gen`) prints a test case's input, and
- the **naive solution** (`generate.naive`) turns that input into the expected
  output.

Both are built like a solution, with the language detected from
`[languages.<key>]`, so a C++ generator and a Python naive solution can be
combined freely.

## Configure the tools

Add the two sources to `neoj.toml`:

```toml
[generate]
gen = "judge/gen.cpp"
naive = "judge/naive.cpp"
```

The generator runs with the **case number as its first argument**, which keeps a
bad case reproducible: if `random-7` is broken, `judge/gen.cpp 7` produces it
again. A typical generator reads the seed, seeds its random engine, and prints
one input:

```cpp
// judge/gen.cpp
#include <iostream>
#include <random>

int main(int argc, char* argv[]) {
    std::mt19937 rng(argc > 1 ? std::stoul(argv[1]) : 0);
    std::cout << rng() % 100 << " " << rng() % 100 << "\\n";
}
```

The naive solution reads the input on standard input and prints the expected
output. It can be intentionally slow or simple; correctness matters, not speed.

## Create cases

```text
$ neoj generate
✔ Created 2 test case(s): random-1, random-2.
```

Each run takes the next free case numbers in the test-case directory, so
existing cases are never replaced. Cases are generated in parallel by default;
a progress bar shows how many are done.

- `-c 20` (`--count`) creates more cases per run. `generate.count` sets the
  default.
- `-i` (`--input`) only creates `.in` files and skips the naive solution, which
  is useful to stress-test a slow solution before paying for the outputs.
- `-J 4` (`--jobs`) caps how many cases are generated at once, and
  `--no-parallel` generates one at a time.

The file names come from `generate.filename` (default `random-{}`), and the
directory from `testcase.folder`. Run `neoj test` afterwards to try the
solution on the new cases.

## Failure and interruption

The generator's standard output is piped straight into the naive solution, and
both parts of a case are kept in memory until both are complete, then written
atomically. This means:

- Ctrl-C kills the running programs and removes the cases that were still being
  written; cases already finished stay on disk.
- A tool that exits with a non-zero status, times out after `generate.timeout`
  seconds, or writes more than the output cap stops the whole run with an error
  that names the case and shows the tool's stderr. Completed cases stay on disk.

A timeout usually means the naive solution is too slow for the inputs the
generator produces — either tune the generator's constraints or raise
`generate.timeout`.

See the [CLI reference](../reference/cli.md#generate) and
[configuration reference](../reference/configuration.md#generategen) for every
option.
