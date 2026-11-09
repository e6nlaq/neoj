# Download sample tests

```bash
neoj download <url>
neoj d <url>          # alias
```

The command accepts an AtCoder, yukicoder, Aizu Online Judge, Codeforces, or
ShareOJ problem URL and replaces the configured test-case directory with the
problem's samples.

```bash
neoj d https://atcoder.jp/contests/abc300/tasks/abc300_a
neoj d https://yukicoder.me/problems/no/480
neoj d https://onlinejudge.u-aizu.ac.jp/courses/lesson/1/ALDS1/1/ALDS1_1_A
neoj d https://codeforces.com/contest/1900/problem/B
neoj d https://www.share-oj.net/problems/04N9rxR9eGNCjAvBNfjU8Z
```

For yukicoder, `neoj` accepts both `/problems/no/<number>` and
`/problems/<problem-id>` URLs. These are different identifiers: the same
numeric value can refer to different problems in each form. Only public problems
can be downloaded: the yukicoder CLI token and API key cannot authenticate the
HTML problem page, so private problems are not supported yet.

For AOJ, `neoj` accepts the v1 URL
(`https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=<id>`), the v2
`/problems/<id>` URL, and the v2 course URL
(`https://onlinejudge.u-aizu.ac.jp/courses/lesson/<...>/<id>`). All three forms
identify the problem by its ID, so re-downloading through another form keeps
your stash and working files. Samples are always read from the v1 page, because
v2 pages render the statement client-side. A `lang=ja` parameter on the v1 URL
is honored and changes the recorded title's language; otherwise the English
page is used.

For Codeforces, `neoj` accepts `/contest/<contest-id>/problem/<index>` and
`/problemset/problem/<contest-id>/<index>` URLs; both identify the same problem
and share one stash key. Gym and group problems require a login, which `neoj`
does not support for Codeforces yet, so they are rejected.

For ShareOJ, `neoj` accepts the `https://www.share-oj.net/problems/<id>` URL,
where `<id>` is the 22-character ID shown in the address bar. The samples are
fetched from the official public API, so only published problems can be
downloaded and no login is needed. Large samples that are published as files
instead of inline text are downloaded and verified against their SHA-256 hash.

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
   `sample-*.out` files, one pair per sample. Files you placed there, including
   handmade cases, are removed.
4. Applies the project template to `src/` when `template.enable = true` and the
   problem changed.
5. Restores the downloaded problem's stash when `stash.auto_apply = true`, the
   problem changed, and a stash exists.
6. Records the problem URL in `.neoj/problem.json`. For AtCoder, the contest
   window is recorded as well; yukicoder problems store only the URL.

Re-downloading the same problem only refreshes the test-case folder. The
template and the stash are not applied again, so working files under `src/` keep
your edits.

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
- AOJ URLs that do not follow one of the three supported forms are rejected with
  a message naming the expected forms.

## Related

- [Change the folder or file names](configure-project.md)
- [Build and run the sample tests](run-tests.md)
- [Apply a solution template](configure-project.md#apply-a-template)
- [Stash and restore work per problem](stash-work.md)
- [CLI reference](../reference/cli.md)
