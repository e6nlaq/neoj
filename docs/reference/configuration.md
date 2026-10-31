# Configuration reference

`neoj` merges `~/.neoj.toml` with the nearest project `neoj.toml` and validates
the result against a strict schema. Unknown keys are errors.

## Keys

| Key                    | Type                   | Default     | Global | Project |
| ---------------------- | ---------------------- | ----------- | ------ | ------- |
| `src`                  | string                 | —           | no     | yes     |
| `testcase.folder`      | string                 | `test`      | yes    | yes     |
| `testcase.filename`    | string                 | `sample-{}` | yes    | yes     |
| `download.show_sample` | boolean                | `false`     | yes    | yes     |
| `template.enable`      | boolean                | `false`     | no     | yes     |
| `template.folder`      | string                 | —           | no     | yes     |
| `template.mode`        | `overlay` or `replace` | `overlay`   | no     | yes     |

Values in the project file override the global file, table by table.

## Example

```toml
src = "src"

[testcase]
folder = "test"
filename = "sample-{}"

[download]
show_sample = false

[template]
enable = false
folder = "template"
mode = "overlay"
```

## Constraints

- `testcase.folder` must be a non-empty relative path that stays inside the
  project. It must not pass through a symbolic link or target `.git`.
- `testcase.filename` must be a file name containing exactly one `{}` and no
  `<>:"/\|?*` characters or control characters.
- `src` and `template.folder` must be non-empty relative paths inside the
  project, and must not overlap.
- `template.folder` must exist when `template.enable = true`; an empty directory
  is allowed.
- Setting `src`, `template.enable`, `template.folder`, or `template.mode` in the
  global file is an error.
- `template.enable = true` also requires `src` and `template.folder`.

## Validation errors

When the merged configuration fails validation, `neoj` reports the paths of the
files it read, then each invalid key with the reason and the received value's
type. Values themselves are not printed.
