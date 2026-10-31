# Configuration

`neoj` reads TOML configuration from two locations and merges them, with the
project file taking precedence over the global file:

| Scope   | Path                                                                                    |
| ------- | --------------------------------------------------------------------------------------- |
| Global  | `~/.neoj.toml`                                                                          |
| Project | `neoj.toml` in the current directory or the nearest ancestor, up to the repository root |

Relative folders are resolved from the directory containing the nearest project
`neoj.toml` (or the current directory when there is no project config), and must
remain inside that directory. Project settings override global settings. The
`src` and `[template]` settings are project-only.

```toml
src = "src" # template destination; required when template.enable = true

[testcase]
folder = "test" # default
filename = "sample-{}" # default; {} is replaced by the 1-based sample number

[download]
show_sample = false # print downloaded input/output samples after success

[template]
enable = false # default; apply a template after downloading samples
folder = "template" # required when enabled; relative to the project root
mode = "overlay" # default; "replace" clears src before copying
```

## Test cases

Each sample is written as `<filename>.in` and `<filename>.out`. For example, the
default creates `sample-1.in` and `sample-1.out`. Downloading replaces the
configured folder without prompting; a failed problem fetch leaves existing tests
untouched. Set `download.show_sample = true` to print each sample's input and
output after the files have been written successfully.

## Templates

When `template.enable = true`, `src` and `template.folder` must both be set to
relative paths inside the project. Downloading overlays files from the template
onto `src` by default, replacing matching paths while preserving other files. Set
`template.mode = "replace"` to remove all contents of `src` before copying.
Hidden files are included. A missing template directory is an error; an empty
template directory is allowed.

## Validation

If configuration does not match the schema, `neoj` lists every invalid key, the
reason, and the received value's type along with the config file paths. Values
themselves are not printed.
