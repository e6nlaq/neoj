# neoj Project Guidelines

## Mission

Build `neoj` as a modern, feature-rich alternative to `oj`, the competitive-programming CLI. Favor a clear CLI experience, reliable problem workflows, and extensible integrations with contest platforms. Treat this as the product direction, not a requirement to copy `oj`'s legacy interface or implement every feature at once.

## Architecture

- Keep the CLI entry point in `src/index.ts` and platform-specific integrations under `packages/api/src/`. `@neoj/api` is published separately; the CLI imports it through the `@neoj/api/*` subpaths.
- Put user-facing command features under `src/feature/`; wire commands in `src/feature/program.ts` (`createProgram()`) with explicit imports, which Bun bundles into a single CLI. `src/index.ts` only parses the program, and completion generation reuses the same command tree.
- Treat contest-window metadata (`event-timer`) as AtCoder-specific. AtCoder uses Turnstile outside contest windows, so submission automation is only reliable during a contest; do not store or rely on contest windows for yukicoder.
- Put shared filesystem and configuration helpers under `src/lib/util/`.
- Keep platform HTTP and HTML handling in `packages/api/src/`, separate from CLI argument parsing and presentation. API modules use relative `./x.js` imports so the emitted declarations resolve in Node.js; run `bun run --filter @neoj/api build` after changing the package surface.
- Add shared abstractions only when multiple integrations need them; avoid speculative frameworks and one-off indirection.
- Validate external URLs and responses, and report actionable errors rather than silently returning incomplete results.

## Distribution

- npm packages: `@neoj/cli` (Node.js launcher), `@neoj/cli-<platform>` (one prebuilt binary each), `@neoj/api` (service clients).
- `@neoj/cli` has no install scripts. npm 12 and Bun block dependency `postinstall` by default, so `bin/neoj.js` resolves `@neoj/cli-<platform>` and spawns its binary. Do not reintroduce a postinstall that swaps the bin target: the package manager writes the shim before install scripts run, and a shebang shim hard-codes `node`, so replacing the file breaks `neoj`.
- Keep the platform table in `bin/neoj.js` in sync with the exact-version `optionalDependencies` and the `packages/cli-*` directories; `test/package-versions.test.ts` checks both. A dependency's `bin` is not linked into `node_modules/.bin` or the global bin directory, so the wrapper must own the `bin` entry itself.
- Linux support is glibc-only; musl/Alpine is out of scope until a `-musl` platform package exists.
- Release order is platform packages → `@neoj/api` → `@neoj/cli`; every package shares the root version.

## Code and Dependencies

- Use TypeScript with strict checking and Bun APIs. Preserve existing naming, formatting, and import conventions.
- Import project modules with the `@/` alias (mapped to `src/` in `tsconfig.json`) instead of `../` relative paths; use relative imports only for files outside `src/`, such as `package.json`.
- Prefer small, typed interfaces for service results and explicit handling of network failures.
- Keep tests deterministic: mock network requests instead of depending on live contest sites.
- Add dependencies only when they materially simplify or enable a needed capability.

## Feature Design

- Before implementing a user-facing feature, use the `grilling` skill(`./.agents/skills/grilling`) to clarify requirements, explore design decisions in rounds, and get explicit confirmation of the resulting specification. Do not start implementation until the user confirms.
- Download template behavior: `neoj download` applies `template.folder` to `src` with `template.mode` (`overlay` or `replace`) only when the downloaded problem differs from `.neoj/problem.json`. Re-downloading the same problem refreshes samples but must not reapply the template or a stash. `src`, `template.folder`, and `testcase.folder` must not overlap, and none may target `.git` or `.neoj`.
- Existing template assets are under `src/assets/template/`: `src/` contains the starter source file, and `template/` contains the problem solution template that `neoj download` applies. `neoj init` copies all bundled template files.

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
- Do not touch `tmp/` folders. It's used by the user. If you need any temporal folders, please use other folders.
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

## Lessons Learned

- `src/lib/util/template-assets.ts` is generated by `scripts/generate-template-assets.ts`. Change the generator, then run `bun run template-assets` or `bun run build`; direct edits are overwritten.
- Project-relative directory rules live in `src/lib/util/project-path.ts`. Route new directory settings through `resolveProjectDirectory()`, and use `assertDirectoriesDoNotOverlap()` instead of reimplementing containment checks.
- Whole-directory replacement must use `commitStagedDirectory()` (rename aside, swap, roll back). Never delete the destination before the replacement is ready.
- Aggregate user-sized arrays with `maxValue()`, not `Math.max(...values)`; spread calls fail on large judge output.
- Apply download-side effects (template, auto-stash, auto-apply) only when the problem changed, so re-downloading the same problem preserves working files.
- When consolidating duplicated validation, search `test/` and `docs/` for the old error strings before changing messages.
- When extending a shared helper with an optional parameter, pass the matching config from every call site (`download`, `test`, `build`, `handmade`); otherwise the safety check applies inconsistently.
- After editing imports, verify that sibling type and value imports still exist; a single-line replacement can drop one.
- `git diff` does not list untracked files. Check `git status --short` before deciding a change set is complete.
- Add a failure-path test for destructive filesystem changes, not only the success path.
- When a test compares absolute paths, derive both sides from the same source (usually `process.cwd()`): `realpath()` alone is not portable, because macOS resolves symlinks (`/var` → `/private/var`) while Windows may return 8.3 short paths (`RUNNER~1`).
- `Bun.spawn` stdin is a `FileSink`: `write()` may return a promise that rejects with `EPIPE` after the reader exits. Await the result and treat a failed write as the end of that relay; an unhandled rejection escapes the pump and fails the entire test run on Windows.
- When one side of an interactive pipe exits first, keep draining the other side's output until EOF instead of cancelling the reader. Cancelling hands the surviving writer an `EPIPE` it cannot handle, which turns a normal early exit into a spurious judge error.
- Reap both interactive children in a `finally` before returning. On Windows a leaked process keeps its working directory and executables locked, so later `rm` calls fail with `EBUSY` and hide the real failure; test cleanup should also pass `maxRetries` to `rm`.
- npm 12 and Bun block dependency install scripts by default: `postinstall` never runs for `npm install -g <pkg>` unless the user passes `--allow-scripts=<pkg>` or sets `npm config set allow-scripts=<pkg> --location=user`, and Bun needs `bun pm -g trust <pkg>`. Never ship a package that relies on `postinstall` to make its `bin` usable; ship a launcher instead and let users opt into the native binaries from a GitHub Release.
- npm links only the top-level package's `bin` into `node_modules/.bin` and the global bin directory; a `bin` declared by an optional dependency is ignored, so the wrapper has to own the entry point.
- npm's Windows shim hard-codes `node` for a target with a shebang, and runs a shebang-less target directly, so a launcher file cannot be replaced by a native binary after install. Keep the launcher and exec the binary from it.
- `npm pack` does not rewrite specifiers, and npm does not understand the `workspace:` protocol (it is a pnpm/Bun extension): pin every cross-package `@neoj/*` dependency to the exact released version so Bun and npm both link the workspace and the published manifests stay installable. Local install tests must also pass the platform tarball explicitly, because the pinned version is not on the registry before the release.
- `actions/upload-artifact` drops the executable bit. Compile the binaries in one job and publish them from another only after `chmod 0755` (and `test -x`), otherwise `npm publish` ships the platform package with a 0644 binary and the launcher fails with `EACCES`.
- `bun build --compile --bytecode` needs `--format=esm` when the entry uses top-level await, which `src/index.ts` does. Compile with `--format=esm --minify --bytecode` and disable the autoload flags so a stray `bunfig.toml`, `.env`, or `package.json` next to the binary cannot change its behavior.

## Response

Please respond in Japanese for the user.
