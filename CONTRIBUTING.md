# Contribute to neoj

## Issues only

Contributions are accepted as **GitHub Issues only**. Pull requests are not
accepted — please do not open one. Any pull request that is opened will be
closed without review.

- Report a bug with the **Bug report** issue template.
- Suggest a feature with the **Feature request** issue template.
- Ask a usage question in
  [Discussions](https://github.com/e6nlaq/neoj/discussions).

A good report includes what you ran, what you expected, and what happened
instead. Include the `neoj --version` output and any relevant configuration or
error messages (never include session cookies or other credentials).

## Working on the code

The rest of this page describes how to build the project and run its checks.
It is useful when you want to investigate an issue locally or verify a fix
before describing it in an issue. You do not need to submit code to report a
problem.

### Set up the repository

```bash
bun install
```

The `prepare` script installs the Lefthook pre-commit hook.

### Run the checks

```bash
bun test           # unit tests
bun run format     # format the code
bun run lint       # lint with Oxlint
bun run typecheck  # type-check with TypeScript
bun run build      # bundle the CLI into dist/
```

The pre-commit hook runs formatting, linting, and type checking.

### Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/),
for example `docs: restructure the guides` or `feat: add problem metadata`.

## Release process

Releases are created manually with the `Release` GitHub Actions workflow
(`.github/workflows/release.yml`):

1. Bump the `version` field in `package.json` on `main` and merge it.
2. Open the **Release** workflow in the Actions tab and run it (optionally as a
   dry run). The version is read from `package.json`.
3. The workflow verifies the version, publishes `@neoj/cli` to npm using trusted
   publishing (OIDC, no stored token), compiles standalone binaries for Linux,
   macOS, and Windows, and creates a GitHub Release tagged `v<version>` with the
   binaries and their checksums attached.

npm trusted publishing must be configured on npmjs.com with this repository,
the `release.yml` workflow file, and no environment. The workflow publishes
with `npm publish --ignore-scripts` after an explicit `bun run build`, so the
package's `prepare` script (Lefthook) never runs in CI.

Binaries are produced with `bun build --compile` and embed the project
templates, so `neoj init` works from a standalone executable.

## Related

- [Platforms](docs/explanation/platforms.md) explains how integrations are
  structured.
