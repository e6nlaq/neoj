# Submit a solution

```bash
neoj submit
neoj submit src/main.cpp
neoj s                        # alias
neoj submits                  # alias
```

`neoj submit` sends the solution to the problem recorded by `.neoj/problem.json`,
so download the problem first. It works with AtCoder and yukicoder.

## Before you submit

You need an initialized project with `neoj.toml`, a downloaded problem, and the
same `[languages.<key>]` section that `neoj test` uses:

```toml
[test]
source = "src/main.cpp"

[languages.cpp]
source = "src/**/*.cpp"
compile = ["g++", "-std=c++23", "-O2", "-o", "{outfile}", "{source}"]
run = ["{outfile}"]
submit = { atcoder = "<id>" }
```

`submit` maps each platform to the language ID used by its submission form. When
the key is missing, the command lists the available IDs and exits with `1`.
`neoj languages <platform>` prints the same list at any time, marks the IDs you
already configured with `*`, and accepts `--filter` to narrow the table; omit
the platform to use the current problem. Copy the right ID into `neoj.toml`, or
pass it for one run:

```bash
neoj languages atcoder --filter python
neoj submit --platform-language <id>
```

`neoj submit` does not compile the file. Run `neoj test` first when you want to
check the samples.

## Review, wait, and submit

The command prints a preview of the submitted text, asks for confirmation
(default **No**), waits a few seconds, and then submits:

```text
Submitting src/main.cpp (languages.cpp, AtCoder)
12 line(s), 214 B

 1 | #include <bits/stdc++.h>
 2 | using namespace std;
...
11 |     return 0;
12 | }

Submit src/main.cpp to AtCoder? (y/N)
```

The preview shows the first and last `submit.preview_lines` lines (5 by default)
with their real line numbers, and prints the whole file when it is short enough.
Then a countdown runs so you can still press Ctrl-C; the default is 3 seconds.

| Option             | Effect                        |
| ------------------ | ----------------------------- |
| `--yes`            | Skip the confirmation prompt. |
| `--wait <seconds>` | Change the wait for one run.  |
| `--no-wait`        | Submit immediately.           |

`--yes` skips only the prompt: the wait still runs. Cancelling the confirmation
or the wait exits with `0` without submitting.

The confirmation prompt, the wait, and the browser behavior come from the
`[submit]` table:

```toml
[submit]
confirm = true
wait = 3
open = true
clip = "never"
preview_lines = 5
```

After a successful submission, neoj prints the submission ID and URL and opens
the page in the browser. A browser that cannot be started only produces a
warning; pass `--no-open` (or set `submit.open = false`) to stay in the terminal.

## Log in once

When no valid session is saved, `neoj submit` starts the login flow
automatically. Cancelling the login exits with `0`; a failed login exits with
`1`. Set `login.auto_login = false` to make the command fail instead and run
`neoj login <platform>` yourself.

See [Log in, check status, and log out](manage-sessions.md).

## Prepare the submitted text

Some languages need a conversion step, such as expanding macros or stripping
comments. Configure `presubmit` on the language:

```toml
[languages.cpp]
source = "src/**/*.cpp"
run = ["{outfile}"]
presubmit = ["python", "tools/expand.py", "{source}", "{outfile}"]
```

The command runs in the project root. `{source}` is the absolute path of your
file and `{outfile}` is a temporary file that keeps the source extension. Write
the text to submit to `{outfile}`, or print it to standard output when the command
does not mention `{outfile}`. The original file is never changed, and the
temporary directory is removed afterwards.

The environment also receives `NEOJ_PLATFORM`, `NEOJ_PROBLEM_URL`, and
`NEOJ_LANGUAGE`. A command that fails, times out (30 seconds by default), or
produces no output stops the submission with its standard error. Use
`--no-presubmit` to send the file unchanged for one run, or raise
`submit.presubmit_timeout`.

## Check without submitting

```bash
neoj submit --dry-run
```

`--dry-run` runs the presubmit command and prints the preview and size, but it
does not log in, contact the platform, resolve a language ID, or copy anything to
the clipboard. It ignores `--wait`, `--no-wait`, `--open`, `--no-open`, and
`--yes`, and cannot be combined with `--platform-language`.

## Keep a copy in the clipboard

`submit.clip` controls whether the submitted text is copied to the clipboard:

```toml
[submit]
clip = "never"   # default
# clip = "always"  # copy after presubmit, then submit
# clip = "fail"    # copy only when submitting fails
```

`"always"` still submits when the clipboard is unavailable; it only warns.
`"fail"` is useful when automatic submission is blocked, because the text is
ready to paste into the browser form. The command still exits with `1` in that
case.

## When automatic submission is blocked

AtCoder applies Turnstile in some situations, so automation is only reliable
inside a contest window. `neoj submit` warns when:

- the contest ID starts with `adt_` (AtCoder Daily Training),
- the current time is outside the contest window stored by `neoj download`, or
- the submission page contains a Turnstile challenge.

The warnings do not stop the submission. If AtCoder rejects the request, the
error includes the submission page URL; open it in your browser and submit from
there. In that case set `submit.clip = "fail"` to have the text ready to paste.

yukicoder accepts submissions through the same API as its web form, so no contest
window is recorded or required.

## Related

- [Build and run the sample tests](run-tests.md)
- [Log in, check status, and log out](manage-sessions.md)
- [Configuration reference](../reference/configuration.md)
- [CLI reference](../reference/cli.md)
