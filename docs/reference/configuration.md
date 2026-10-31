# Configuration reference

`neoj` reads `~/.neoj.toml` and the nearest project `neoj.toml`, merges them, and
validates the result against a strict schema. Unknown keys are errors. The merge
is table by table: a key set in the project file replaces the same key from the
global file, and every other key is kept.

Each key may only be set in the scope listed below. Setting `src` or any
`[template]` key in the global file is an error.

## Keys

### `src`

| Type        | Default | Scope   |
| ----------- | ------- | ------- |
| string path | none    | project |

Destination directory for the solution template, resolved from the project root.
It is required when `template.enable = true`, must stay inside the project, must
not pass through a symbolic link, and must not overlap `template.folder`.

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

## Validation errors

When the merged configuration fails validation, `neoj` reports the paths of the
files it read, then each invalid key with the reason and the received value's
type. Values themselves are not printed.
