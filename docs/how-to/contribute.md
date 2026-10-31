# Contribute to neoj

## Set up the repository

```bash
bun install
```

The `prepare` script installs the Lefthook pre-commit hook.

## Run the checks

```bash
bun test           # unit tests
bun run format     # format the code
bun run lint       # lint with Oxlint
bun run typecheck  # type-check with TypeScript
bun run build      # bundle the CLI into dist/
```

The pre-commit hook runs formatting, linting, and type checking. Ensure
`bun test` passes before opening a pull request.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/),
for example `docs: restructure the guides` or `feat: add problem metadata`.

## Related

- [Platforms](../explanation/platforms.md) explains how integrations are
  structured.
