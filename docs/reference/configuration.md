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
not pass through a symbolic link, and must not overlap `template.folder`.

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

### `testcase.folder`

| Type        | Default | Scope             |
| ----------- | ------- | ----------------- |
| string path | `test`  | global or project |

Directory that receives downloaded samples. The path is resolved from the project
root (the directory containing the nearest `neoj.toml`). It must stay inside the
project, must not pass through a symbolic link, and must not target `.git`.

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

Apply the template to `src` after each successful download. Enabling it requires
both `src` and `template.folder`.

### `template.folder`

| Type        | Default | Scope   |
| ----------- | ------- | ------- |
| string path | none    | project |

Directory holding the template files, resolved from the project root. It must
exist when `template.enable = true`; an empty directory is allowed. The path
must stay inside the project, must not overlap `src`, and the tree must not
contain symbolic links. Hidden files are copied like any other file.

### `template.mode`

| Type                   | Default   | Scope   |
| ---------------------- | --------- | ------- |
| `overlay` or `replace` | `overlay` | project |

How the template is applied to `src`:

- `overlay` copies the template over `src`, replacing files that exist in both
  places and keeping everything else.
- `replace` removes the contents of `src` before copying the template.

## Example

```toml
src = "src"

[alias]
main = "src/main.cpp"
old = "archive/2019/a.cpp"

[login]
open_browser = true

[testcase]
folder = "test"
filename = "sample-{}"

[test]
source = "src/main.cpp"
timeout = 10
memory = 1024
parallel = true
cache = false
ignore_trailing_space = false
ignore_trailing_newline = false
show_stderr = "always"

[languages.cpp]
source = "src/**/*.cpp"
compile = ["g++", "-std=c++23", "-O2", "-o", "{outfile}", "{source}"]
run = ["{outfile}"]
timeout = 10
memory = 1024
cache_files = ["src/**/*.hpp"]

[download]
show_sample = false

[stash]
auto_stash = false
auto_apply = false
force = true

[template]
enable = false
folder = "template"
mode = "overlay"
```

## Validation errors

When the merged configuration fails validation, `neoj` reports the paths of the
files it read, then each invalid key with the reason and the received value's
type. Values themselves are not printed.
