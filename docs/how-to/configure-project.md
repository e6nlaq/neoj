# Configure a project

`neoj` reads TOML from a global file and a project file, then merges them.

| Scope   | Path                                                                                    |
| ------- | --------------------------------------------------------------------------------------- |
| Global  | `~/.neoj.toml`                                                                          |
| Project | `neoj.toml` in the current directory or the nearest ancestor, up to the repository root |

Project values win over global values. `src` and `[template]` are project-only;
setting either in the global file is an error.

## Control the browser during login

```toml
[login]
open_browser = true
```

This controls the yukicoder CLI-token device flow. When it is `true` (the
default), `neoj` opens the verification page in your browser. The URL and code
are printed either way, so set it to `false` on headless or SSH sessions.

## Change the test folder or file names

```toml
[testcase]
folder = "test"
filename = "sample-{}"

[handmade]
filename = "handmade-{}"
```

- `folder` must be a relative path inside the project, must not pass through a
  symbolic link, and must not target `.git` or `.neoj`. It must also not overlap
  `src` (neither directory may contain the other).
- `filename` must be a plain file name containing exactly one `{}`, which is
  replaced by the 1-based sample number.
- `handmade.filename` names the cases created by `neoj handmade`. They use the
  same `folder` and the same `{}` rules, and get the next free number.
- `generate.filename` names the cases created by `neoj generate`, with the same
  rules; see [Generate random test cases](generate-random-tests.md).

Relative folders are resolved from the directory containing the nearest project
`neoj.toml`. Downloading replaces the folder without prompting.

## Print samples after downloading

```toml
[download]
show_sample = true
```

`neoj` prints each sample's input and output after the files have been written
successfully.

## Stash work when switching problems

```toml
[stash]
auto_stash = true
auto_apply = true
force = true
```

`auto_stash` saves the previous problem's `src` and test-case directory before a
download replaces them, and `auto_apply` restores the downloaded problem's stash
after the download. Both only run when the downloaded problem differs from the
one in `.neoj/problem.json`. `stash.force` (default `true`) controls whether
`neoj stash save` may replace an existing stash. See
[Stash and restore work per problem](stash-work.md).

## Apply a template

```toml
src = "src"

[template]
enable = true
folder = "template"
exclude = ["*.md", ".gitkeep"]
mode = "overlay"
```

With `enable = true`, both `src` and `template.folder` are required. After a
download that changes the problem, `neoj` copies the template into `src`:

- `template.exclude` lists globs for files that must not be copied. Patterns
  match the path relative to `template.folder` and the entry name, so `*.md`
  also excludes Markdown files inside subdirectories. A matching directory is
  skipped with its contents.

- `mode = "overlay"` (default) replaces files that exist in both places and keeps
  the rest.
- `mode = "replace"` removes the contents of `src` first.

Hidden files are included, symbolic links inside the template are rejected, and
the two directories must not overlap. A missing template directory is an error;
an empty one is allowed. Downloading the same problem again does not reapply the
template, so it never overwrites edits in `src`.

## Related

- [Configuration reference](../reference/configuration.md) for every key and
  default.
- [Set up editor completions](setup-editor-completions.md).
- [Download sample tests](download-samples.md).
