# neoj

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

To initialize a project from the bundled templates:

```bash
bun run src/index.ts init
```

The command uses the nearest ancestor containing `neoj.toml` as the destination,
or the current directory when no project config is found. Existing files are
skipped; pass `--force` to overwrite them.

To type check:

```bash
bun check
```

Run `bun fmt` to format the code.

This project was created using `bun init` in bun v1.4.4. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
