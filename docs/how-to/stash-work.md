# Stash and restore work per problem

`neoj download` replaces the test-case directory and applies the template, so
hand-edited tests and code are lost when you move to another problem. `neoj
stash` keeps a snapshot of the working files for each problem, so you can switch
back and forth without losing work.

A stash belongs to one problem and is stored under `.neoj/stash/`, next to
`.neoj/problem.json`. Downloading other problems does not remove it. Stashes are
unrelated to Git: the bundled `.gitignore` already ignores `.neoj/`, so they are
not committed by default.

## Commands

```bash
neoj stash            # same as: neoj stash save
neoj stash save
neoj stash list
neoj stash apply
neoj stash pop
neoj stash drop
neoj stash clear --force
```

| Command | Description                                               |
| ------- | --------------------------------------------------------- |
| `save`  | Save the current problem's working files.                 |
| `list`  | Show every stash; the current problem is marked with `*`. |
| `apply` | Restore the current problem's stash.                      |
| `pop`   | Restore the current problem's stash, then remove it.      |
| `drop`  | Remove the current problem's stash.                       |
| `clear` | Remove every stash. `--force` is required.                |

Every command except `list` and `clear` works on the problem recorded in
`.neoj/problem.json`, so run `neoj download <url>` first. `neoj stash` reports
an error when no problem is recorded or when the current problem has no stash.

`save` replaces an existing stash of the same problem. That is allowed by default
and can be disabled with `stash.force = false`, which makes `save` fail until you
pass `--force`.

## What is saved

A snapshot contains:

- `src` when it is configured, with every file and subdirectory.
- The `testcase.folder` directory.

Symbolic links and other special files are rejected with an error. Two logical
directories are stored with fixed names inside the stash:

```
.neoj/stash/atcoder/abc300_a/
├── meta.json
├── src/
│   └── main.cpp
└── testcase/
    ├── sample-1.in
    └── sample-1.out
```

`meta.json` records the problem URL, the platform and slug, the save time, and
the configured folder names at save time. The slug comes from the problem URL
(`abc300_a` for AtCoder, `no480` for yukicoder), so the directory is readable.

## Restoring

`apply` restores into the directories from your current configuration, not the
paths recorded at save time. Renaming `testcase.folder` between `save` and
`apply` therefore still works, and `neoj` warns when the name changed. When `src`
is no longer configured but the stash contains it, that part is skipped with a
warning.

Restoring is exact: files in the stash are written, and files that exist locally
but not in the stash are removed. The command reports how many files were written
and removed. The stash itself is kept until you run `pop`, `drop`, or `clear`.

## Automate it

```toml
[stash]
auto_stash = true
auto_apply = true
force = true
```

With both options enabled, `neoj download` behaves like this:

1. Fetch the problem.
2. When the problem differs from the one in `.neoj/problem.json`, save that
   previous problem's working files.
3. Replace the test-case directory and apply the template.
4. Restore the new problem's stash if it has one.

Both options only run when the problem changes, so re-downloading the same
problem never replaces fresh samples with an old snapshot. A failed fetch leaves
both the working files and the stashes untouched.

## Related

- [Download sample tests](download-samples.md)
- [Configure a project](configure-project.md)
- [CLI reference](../reference/cli.md)
