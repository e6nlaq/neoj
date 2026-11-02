# Set up editor completions

`neoj` publishes a JSON Schema for its TOML configuration. Editors that attach a
JSON Schema to a TOML document complete the configuration keys and show their
descriptions on hover. The schema is generated from the same definition `neoj`
uses to validate configuration, so the keys, defaults, and allowed values match
what the CLI accepts.

```text
https://raw.githubusercontent.com/e6nlaq/neoj/main/schema/neoj.schema.json
```

## VS Code

Install [Even Better TOML](https://marketplace.visualstudio.com/items?itemName=tamasfe.even-better-toml).
It adds TOML support backed by Taplo, including the `#:schema` directive.

`neoj init` writes the directive as the first line of the project `neoj.toml`.
For a project created earlier, add the line yourself at the very top of the
file:

```toml
#:schema https://raw.githubusercontent.com/e6nlaq/neoj/main/schema/neoj.schema.json
```

The directive must come before any key or table, and a document may contain only
one. No extension setting is needed.

## Global configuration

`neoj` does not create `~/.neoj.toml`. Add the same first line when you create
the file:

```toml
#:schema https://raw.githubusercontent.com/e6nlaq/neoj/main/schema/neoj.schema.json

[login]
open_browser = false
```

## Other editors

The `#:schema` directive is a Taplo feature, so any editor with a Taplo language
server reads it, including Zed, Helix, and Neovim with a Taplo language server.

## Offline use

Keep a copy of the schema and point the directive at it. Relative paths are
resolved from the TOML file:

```toml
#:schema ./path/to/neoj.schema.json
```

## Limits

- The schema is an editor aid. `neoj` still validates the merged configuration
  and rejects unknown keys at runtime.
- The URL points at `main`, so the schema describes the latest development
  state. A key added after your installed release is completed in the editor
  but rejected by `neoj`.
- `src` and every `[template]` key are project-only. Both files share one
  schema, so the editor accepts them in `~/.neoj.toml`; `neoj` reports an error
  when they are set there.
- The schema is not registered in the JSON Schema Store yet, so a file picks it
  up only through the `#:schema` line.

## Next steps

- [Configuration reference](../reference/configuration.md) for every key and
  default.
- [Configure a project](configure-project.md).
