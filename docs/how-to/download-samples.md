# Download sample tests

```bash
neoj download <url>
neoj d <url>          # alias
```

The command accepts an AtCoder or yukicoder problem URL and replaces the
configured test-case directory with the problem's samples.

```bash
neoj d https://atcoder.jp/contests/abc300/tasks/abc300_a
neoj d https://yukicoder.me/problems/no/480
```

For yukicoder, `neoj` accepts both `/problems/no/<number>` and
`/problems/<problem-id>` URLs. Only public problems can be downloaded: the
yukicoder CLI token and API key cannot authenticate the HTML problem page, so
private problems are not supported yet.

## Before you run it

The command needs a project with a `neoj.toml`. Run [`neoj init`](../tutorial.md)
in an empty directory if you have not created one yet. `neoj` searches the
current directory and its ancestors for the nearest `neoj.toml`, stopping at the
repository root, so you can run it from a subdirectory of the project.

## What the command does

1. Fetches the problem through the matching platform integration.
2. Saves the previous problem's working files when `stash.auto_stash = true` and
   the problem changed.
3. Replaces the test-case folder (`test/` by default) with `sample-*.in` and
   `sample-*.out` files, one pair per sample.
4. Applies the project template to `src/` when `template.enable = true`.
5. Restores the downloaded problem's stash when `stash.auto_apply = true`, the
   problem changed, and a stash exists.
6. Records the problem URL in `.neoj/problem.json`. For AtCoder, the contest
   window is recorded as well; yukicoder problems store only the URL.

The summary reports how many samples were written. Set
`download.show_sample = true` to print each sample's contents as well.

## When something fails

- A failed fetch leaves the existing test cases untouched; the folder is only
  replaced after the problem has been retrieved.
- When an AtCoder problem returns 404 and you are not logged in, the error
  suggests running `neoj login atcoder`.
- A yukicoder URL that does not point to an existing problem is reported as a
  missing problem page, even though the site responds with HTTP 200.
- A problem without samples recreates the test-case folder as an empty directory.

## Related

- [Change the folder or file names](configure-project.md)
- [Build and run the sample tests](run-tests.md)
- [Apply a solution template](configure-project.md#apply-a-template)
- [Stash and restore work per problem](stash-work.md)
- [CLI reference](../reference/cli.md)
