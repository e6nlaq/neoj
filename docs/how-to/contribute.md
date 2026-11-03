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

## Release process

Releases are created manually with the `Release` GitHub Actions workflow
(`.github/workflows/release.yml`):

1. Bump the `version` field in `package.json` on `main` and merge it.
2. Open the **Release** workflow in the Actions tab and run it (optionally as a
   dry run). The version is read from `package.json`.
3. The workflow verifies the version, publishes `neo-oj` to npm using trusted
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

- [Platforms](../explanation/platforms.md) explains how integrations are
  structured.
