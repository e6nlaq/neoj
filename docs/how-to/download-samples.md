# Download sample tests

```bash
neoj download <url>
neoj d <url>          # alias
```

The command accepts an AtCoder contest task URL and replaces the configured
test-case directory with the problem's samples.

## Before you run it

The command needs a project with a `neoj.toml`. Run [`neoj init`](../tutorial.md)
in an empty directory if you have not created one yet. `neoj` searches the
current directory and its ancestors for the nearest `neoj.toml`, stopping at the
repository root, so you can run it from a subdirectory of the project.

## What the command does

1. Fetches the problem through the matching platform integration.
2. Replaces the test-case folder (`test/` by default) with `sample-*.in` and
   `sample-*.out` files, one pair per sample.
3. Applies the project template to `src/` when `template.enable = true`.
4. Records the problem URL and contest window in `.neoj/problem.json`.

The summary reports how many samples were written. Set
`download.show_sample = true` to print each sample's contents as well.

## When something fails

- A failed fetch leaves the existing test cases untouched; the folder is only
  replaced after the problem has been retrieved.
- When the problem returns 404 and you are not logged in, the error suggests
  running `neoj login atcoder`.
- A problem without samples recreates the test-case folder as an empty
  directory.

## Related

- [Change the folder or file names](configure-project.md)
- [Apply a solution template](configure-project.md#apply-a-template)
- [CLI reference](../reference/cli.md)
