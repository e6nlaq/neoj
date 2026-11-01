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
```

- `folder` must be a relative path inside the project and must not pass through
  a symbolic link.
- `filename` must be a plain file name containing exactly one `{}`, which is
  replaced by the 1-based sample number.

Relative folders are resolved from the directory containing the nearest project
`neoj.toml`. Downloading replaces the folder without prompting.

## Print samples after downloading

```toml
[download]
show_sample = true
```

`neoj` prints each sample's input and output after the files have been written
successfully.

## Apply a template

```toml
src = "src"

[template]
enable = true
folder = "template"
mode = "overlay"
```

With `enable = true`, both `src` and `template.folder` are required. After a
download, `neoj` copies the template into `src`:

- `mode = "overlay"` (default) replaces files that exist in both places and keeps
  the rest.
- `mode = "replace"` removes the contents of `src` first.

Hidden files are included, symbolic links inside the template are rejected, and
the two directories must not overlap. A missing template directory is an error;
an empty one is allowed.

## Related

- [Configuration reference](../reference/configuration.md) for every key and
  default.
- [Download sample tests](download-samples.md).
