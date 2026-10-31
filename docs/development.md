# Development

```bash
bun install
bun test           # unit tests
bun run format     # format the code
bun run lint       # lint with Oxlint
bun run typecheck  # type-check with TypeScript
bun run build      # bundle the CLI into dist/
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). The
pre-commit hook runs formatting, linting, and type checking.
