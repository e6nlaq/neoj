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
bun run hooks
```

`bun run hooks` installs the Lefthook pre-commit hook. The package ships no
install scripts, so npm and Bun do not run anything when someone installs
`@neoj/cli`.

### Run the checks

```bash
bun test           # unit tests
bun run format     # format the code
bun run lint       # lint with Oxlint
bun run typecheck  # type-check with TypeScript
bun run build      # bundle the CLI into dist/ and emit @neoj/api declarations
```

The pre-commit hook runs formatting, linting, and type checking.

### Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/),
for example `docs: restructure the guides` or `feat: add problem metadata`.

## Release process

Releases are created manually with the `Release` GitHub Actions workflow
(`.github/workflows/release.yml`):

1. Set the version everywhere: `bun run set-version 0.1.0` rewrites the root
   `package.json`, every `packages/*/package.json`, the exact `@neoj/*` pins, and
   `bun.lock`. Run `bun install`, commit, and merge to `main`.
   `test/package-versions.test.ts` fails when the versions disagree.
2. Open the **Release** workflow in the Actions tab and run it (optionally as a
   dry run). The version is read from the root `package.json`.
3. The workflow verifies the version and that every package is unpublished,
   compiles standalone binaries for Linux, macOS, and Windows, generates
   `THIRD_PARTY_NOTICES.txt` (`bun run notices <output>`; the file is never
   committed), packages each binary with it and the `LICENSE` file into a zip
   archive for the GitHub Release, drops each binary into its
   `@neoj/cli-<platform>` package, and publishes in dependency order: the
   platform packages, `@neoj/api`, then `@neoj/cli`. Finally it creates a
   GitHub Release tagged `v<version>` with the zip archives and their
   checksums attached.

npm trusted publishing must be configured on npmjs.com for every published
package (`@neoj/cli`, `@neoj/api`, and the five `@neoj/cli-<platform>` packages),
with this repository, the `release.yml` workflow file, and no environment. The
workflow publishes with `npm publish --ignore-scripts`.

Trusted publishing cannot be configured until a package exists, so the first
publish of `@neoj/api` and the platform packages is done by a maintainer. Copy
the compiled binaries into `packages/cli-<platform>/` first, then publish
everything except the wrapper:

```bash
for package in cli-linux-x64 cli-linux-arm64 cli-darwin-x64 cli-darwin-arm64 cli-win32-x64 api; do
    (cd "packages/$package" && npm publish --access public)
done
```

The wrapper goes last: `npm publish --access public` in the repository root.

Binaries are produced with `bun build --compile` and embed the project
templates, so `neoj init` works from a standalone executable. The compiled
binaries are not committed; the `@neoj/cli` tarball only ships the Node.js
launcher in `bin/neoj.js`, which starts the `@neoj/cli-<platform>` binary. The
package has no install scripts, so it works with npm 12's default of blocking
them.

## Related

- [Platforms](docs/explanation/platforms.md) explains how integrations are
  structured.
