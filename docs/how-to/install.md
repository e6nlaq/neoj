English | [日本語](../ja/install.md)

# Install neoj

`neoj` is published on npm as `@neoj/cli`. Install it globally with Bun or npm.

## With Bun (recommended)

```bash
bun install -g @neoj/cli
```

## With npm

```bash
npm install -g @neoj/cli
```

## Prebuilt binaries

Unsigned standalone executables are attached to each
[GitHub Release](https://github.com/e6nlaq/neoj/releases):

- `neoj-<version>-linux-x64`
- `neoj-<version>-linux-arm64`
- `neoj-<version>-darwin-x64`
- `neoj-<version>-darwin-arm64`
- `neoj-<version>-windows-x64.exe`

Download the matching file, make it executable, and place it on your `PATH`:

```bash
chmod +x neoj-<version>-linux-x64
./neoj-<version>-linux-x64 --version
```

On macOS, the first run may be blocked by Gatekeeper because the binaries are
unsigned. Remove the quarantine attribute if needed:

```bash
xattr -d com.apple.quarantine ./neoj-<version>-darwin-arm64
```

SHA-256 checksums for every asset are published as `SHA256SUMS.txt` in the same
release.

## Requirements

`neoj` requires [Bun](https://bun.com) 1.4 or newer at runtime. If Bun is not
already available, follow the [Bun installation guide](https://bun.com/docs/installation)
first.

Verify that the CLI is on your `PATH`:

```bash
neoj --help
```

## Next steps

- [Download your first problem](../tutorial.md).
- [Log in to a platform](manage-sessions.md).
