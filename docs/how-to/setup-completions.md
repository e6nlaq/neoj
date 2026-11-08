# Set up shell completions

`neoj` prints a static completion script for bash, zsh, fish, or PowerShell.
The script is written to standard output, so you install it wherever your shell
reads its configuration.

```bash
neoj completions <shell>
neoj completion <shell>   # alias
```

Replace `<shell>` with `bash`, `zsh`, `fish`, or `powershell`. Regenerate the
script after upgrading `neoj` so that new commands and options appear.

## Bash

Add this line to `~/.bashrc`:

```bash
eval "$(neoj completions bash)"
```

Bash cannot show descriptions next to candidates, so only the command, option,
and value names appear.

## Zsh

Load `compinit` first, then add this line to `~/.zshrc`:

```zsh
eval "$(neoj completions zsh)"
```

You can also install the script into a directory on `fpath`:

```zsh
neoj completions zsh > "${fpath[1]}/_neoj"
```

The generated script starts with `#compdef neoj` and supports both loading
methods. Run `compinit` again after writing the file.

## Fish

Write the script to Fish's completions directory:

```fish
neoj completions fish > ~/.config/fish/completions/neoj.fish
```

Fish loads files from that directory automatically, so no further configuration
is needed.

## PowerShell

PowerShell completion requires PowerShell 7.2 or later, which supports native
command argument completers. Add this line to your `$PROFILE`:

```powershell
neoj completions powershell | Out-String | Invoke-Expression
```

Windows PowerShell 5.1 does not support native argument completers, so `neoj`
completion is not available there.

## What is completed

- Commands, their aliases (`d`, `o`, `h`, `langs`, `completion`), and
  subcommands such as `login atcoder` and `stash save`.
- Options for nested commands such as `neoj login atcoder` and
  `neoj stash save`.
- Platform names (`atcoder`, `yukicoder`) for login commands, `--service`, and
  the `neoj languages` argument.
- `token` and `api-key` for `neoj login yukicoder --method`.
- Shell names for `neoj completions`.

The `<url>` argument of `neoj download` has no candidates, and `neoj` does not
offer file names for any argument.

## Next steps

- [CLI reference](../reference/cli.md).
- [Configure a project](configure-project.md).
