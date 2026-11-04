# Create a test case by hand

```bash
neoj handmade
neoj h          # alias
```

`neoj handmade` asks you to type one test case, then writes it as an `.in` and an
`.out` file next to the downloaded samples. Run it when a problem's samples do
not cover a case you want to check.

## Enter the case

```text
$ neoj handmade
test/handmade-1.in and test/handmade-1.out will be created.
input> 1 2
input>

output> 3
output>
✔ Created test/handmade-1.in and test/handmade-1.out.
```

Type the input one line at a time and press Enter on an empty line to finish the
block. Do the same for the expected output; a blank line separates the two
blocks. To create an empty input or output, press Enter immediately.

The files are written only after both blocks are complete. Ctrl-C, or Ctrl-D
(Ctrl-Z on Windows), cancels the command and leaves the directory untouched, so a
mistyped case never leaves half a pair behind.

The command needs an interactive terminal; piping input into it is rejected.

## Run the new case

The files live in the same directory as the samples, so the next run picks them
up:

```bash
neoj test
neoj test -f handmade-1     # only the handmade case
```

## Choose the file name

`handmade.filename` sets the base name. It must contain exactly one `{}`, which
is replaced by the case number:

```toml
[handmade]
filename = "handmade-{}"
```

The directory is `testcase.folder`, the same one `neoj download` uses. The
command picks the smallest number whose `.in` and `.out` files do not exist yet,
so it never overwrites a case. Delete the files you no longer need to reuse their
number.

## Keep in mind

`neoj download` replaces the whole test-case directory. Downloading another
problem removes handmade cases along with the old samples, so copy a case
somewhere else first if you want to keep it.

## Related

- [Download sample tests](download-samples.md)
- [Build and run the sample tests](run-tests.md)
- [Change the folder or file names](configure-project.md)
- [Configuration reference](../reference/configuration.md)
