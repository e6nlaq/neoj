# neoj Project Guidelines

## Mission

Build `neoj` as a modern, feature-rich alternative to `oj`, the competitive-programming CLI. Favor a clear CLI experience, reliable problem workflows, and extensible integrations with contest platforms. Treat this as the product direction, not a requirement to copy `oj`'s legacy interface or implement every feature at once.

## Architecture

- Keep the CLI entry point in `src/index.ts` and platform-specific integrations under `src/lib/service/`.
- Put user-facing command features under `src/feature/`; wire commands in `src/feature/program.ts` (`createProgram()`) with explicit imports, which Bun bundles into a single CLI. `src/index.ts` only parses the program, and completion generation reuses the same command tree.
- Treat contest-window metadata (`event-timer`) as AtCoder-specific. AtCoder uses Turnstile outside contest windows, so submission automation is only reliable during a contest; do not store or rely on contest windows for yukicoder.
- Put shared filesystem and configuration helpers under `src/lib/util/`.
- Keep platform HTTP and HTML handling in service modules, separate from CLI argument parsing and presentation.
- Add shared abstractions only when multiple integrations need them; avoid speculative frameworks and one-off indirection.
- Validate external URLs and responses, and report actionable errors rather than silently returning incomplete results.

## Code and Dependencies

- Use TypeScript with strict checking and Bun APIs. Preserve existing naming, formatting, and import conventions.
- Import project modules with the `@/` alias (mapped to `src/` in `tsconfig.json`) instead of `../` relative paths; use relative imports only for files outside `src/`, such as `package.json`.
- Prefer small, typed interfaces for service results and explicit handling of network failures.
- Keep tests deterministic: mock network requests instead of depending on live contest sites.
- Add dependencies only when they materially simplify or enable a needed capability.

## Feature Design

- Before implementing a user-facing feature, use the `grilling` skill to clarify requirements, explore design decisions in rounds, and get explicit confirmation of the resulting specification. Do not start implementation until the user confirms.
- Pending download-template feature: when `template.enable = true`, `neoj download` should apply a template to the project's `src/` directory. The user wants the replacement strategy configurable: either overwrite only files present in the template (the default), or remove all of `src/` and copy the template. The exact config key for the strategy, template source, and application timing are not yet confirmed; resolve these with the user through grilling before implementation.
- Existing template assets are under `src/assets/template/`: `src/` contains the starter source file, and `template/` contains the problem solution template. `neoj init` currently copies all bundled template files. Do not assume which asset subtree the download feature should use until confirmed.

## Shell Completions

- `neoj completions <shell>` prints a static completion script to stdout for `bash`, `zsh`, `fish`, and `powershell`. Do not add a runtime `__complete` hook, an `install` subcommand, or a completion dependency without confirming the design with the user.
- Build the completion data with `buildCompletionModel()` in `src/lib/util/completion.ts` from `createProgram()`, so the CLI and the completion scripts share one command tree. Shell syntax and escaping belong in the renderers under `src/feature/completions/`.
- Commander supplies command names, aliases, options, and arguments automatically. Add static values in `getCompletionHints()`: option values keyed by long flag (`--service`, `--method`) and argument values keyed by `command path:argument name` (`completions:shell`). Derive those values from shared data (`platforms`, `yukicoderLoginMethods`) instead of duplicating lists.
- Completion behavior is part of the UX: include aliases, do not fall back to file completion, and attach descriptions where the shell supports them (fish, zsh, PowerShell; bash cannot show them). PowerShell targets `pwsh` 7.2+; Windows PowerShell 5.1 is unsupported.
- Tests in `test/completions.test.ts` assert the model contents and required script elements; do not add full-script snapshots. Exercise generated scripts in real shells when available (Git Bash, `pwsh`). Dot-sourcing a `.txt` file in PowerShell registers completers in a temporary scope, so use a `.ps1` file or pipe the script into `Invoke-Expression` when testing.
- Update `docs/how-to/setup-completions.md`, `docs/reference/cli.md`, and the README in the same change that alters the completion command, supported shells, or candidates.

## Validation

Run the relevant checks before finishing changes:

- `bun test` — run tests
- `bun run format` — format the project
- `bun run lint` — run Oxlint
- `bun run typecheck` — run the TypeScript check
- `bun run build` — build the CLI when changes affect packaging or runtime output

The Lefthook pre-commit hook runs formatting, lint, and typecheck. Commit messages follow Conventional Commits.

## Security and Credentials

- Treat contest session cookies as account credentials. Never print them to logs, error messages, or test output, and never commit them or a populated `.env`.
- Write credential files atomically (temporary file in the same directory, then rename) so an interrupted run cannot truncate saved data. Create the directory with `0700` and the file with `0600`, ignoring permission failures on platforms that do not support them.
- Normalize and validate credential input in one place at the boundary: strip the cookie name, reject unexpected characters and malformed percent-encoding, and report which check failed.
- Do not construct HTTP headers by interpolating unvalidated user input.

## Repository Hygiene

- Do not commit scratch scripts, captured HTML, temporary `.env` files, or other exploration artifacts. Keep them in the git-ignored `tmp/` directory or delete them before committing.
- Remove dependencies as soon as the code that used them is deleted, and keep `package.json` metadata (`description`, `repository`, `license`, `engines`, scripts) accurate.
- Never install the package into its own `node_modules` (for example with `bun link` or `bun add neoj`). A self-referencing `node_modules/neoj` nests indefinitely; delete `node_modules` and reinstall if it appears.
- Keep `README.md` and the pages under `docs/` aligned with the actual CLI
  surface. Update them in the same change that alters commands, flags, or file
  locations.

## Review Checklist

- Network requests need a timeout, a descriptive `User-Agent`, and a wrapper that turns transport failures into domain errors with an actionable message.
- Every read-modify-write of a credential file must be atomic, and validation errors must name the file or cookie involved.
- CLI `.action` callbacks should delegate to exported functions so behavior can be tested without spawning the CLI.
- Verify login state with a stable endpoint and a documented signal; avoid hard-coding a single contest page, and document the heuristic's limits when it is not exhaustive.
- When a command can work without the network, offer an offline path and label the result as unverified instead of failing.
- Add or update tests for each behavior change, including the failure paths (invalid input, malformed saved data, network errors).
- When commands, aliases, options, or arguments change, regenerate each completion script and confirm the candidates and docs still match `createProgram()`.

## Responce

Please responce in Japanese for the user.
