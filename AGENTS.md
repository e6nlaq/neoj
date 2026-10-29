# neoj Project Guidelines

## Mission

Build `neoj` as a modern, feature-rich alternative to `oj`, the competitive-programming CLI. Favor a clear CLI experience, reliable problem workflows, and extensible integrations with contest platforms. Treat this as the product direction, not a requirement to copy `oj`'s legacy interface or implement every feature at once.

## Architecture

- Keep the CLI entry point in `src/index.ts` and platform-specific integrations under `src/lib/service/`.
- Put user-facing command features under `src/feature/`; load optional command modules dynamically from the CLI entry point.
- Put shared filesystem and configuration helpers under `src/lib/util/`.
- Keep platform HTTP and HTML handling in service modules, separate from CLI argument parsing and presentation.
- Add shared abstractions only when multiple integrations need them; avoid speculative frameworks and one-off indirection.
- Validate external URLs and responses, and report actionable errors rather than silently returning incomplete results.

## Code and Dependencies

- Use TypeScript with strict checking and Bun APIs. Preserve existing naming, formatting, and import conventions.
- Prefer small, typed interfaces for service results and explicit handling of network failures.
- Keep tests deterministic: mock network requests instead of depending on live contest sites.
- Add dependencies only when they materially simplify or enable a needed capability.

## Validation

Run the relevant checks before finishing changes:

- `bun test` — run tests
- `bun run format` — format the project
- `bun run lint` — run Oxlint
- `bun run typecheck` — run the TypeScript check
- `bun run build` — build the CLI when changes affect packaging or runtime output

The Lefthook pre-commit hook runs formatting, lint, and typecheck. Commit messages follow Conventional Commits.
