# Install neoj

`neoj` is published on npm as `@neoj/cli`. The package ships a small Node.js
launcher; it starts the prebuilt binary for your platform, so you do not need
Bun and you do not need to allow install scripts.

## With npm

```bash
npm install -g @neoj/cli
```

## With Bun

```bash
bun add -g @neoj/cli
```

Neither npm nor Bun runs package install scripts for `@neoj/cli`: the package
has none. The launcher finds `@neoj/cli-<platform>` in the installed tree and
runs its binary, so `neoj` works with the defaults of npm 12 and newer and with
Bun's blocked-script default.

## Prebuilt binaries

If you want to skip the Node.js startup cost, download the standalone
executable attached to each
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

## Supported platforms

| Platform            | npm package              |
| ------------------- | ------------------------ |
| Linux x64 (glibc)   | `@neoj/cli-linux-x64`    |
| Linux arm64 (glibc) | `@neoj/cli-linux-arm64`  |
| macOS x64           | `@neoj/cli-darwin-x64`   |
| macOS arm64         | `@neoj/cli-darwin-arm64` |
| Windows x64         | `@neoj/cli-win32-x64`    |

Linux binaries link against glibc. Alpine Linux and other musl distributions are
not supported yet.

Node.js 18 or newer is needed to run the launcher. The standalone binaries have
no runtime dependency.

## Verify the installation

```bash
neoj --help
```

## Next steps

- [Download your first problem](../tutorial.md).
- [Log in to a platform](manage-sessions.md).
