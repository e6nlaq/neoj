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
[GitHub Release](https://github.com/e6nlaq/neoj/releases). Every release
publishes one zip archive per platform, containing the binary, the `LICENSE`
file, and `THIRD_PARTY_NOTICES.txt` (the license notices of the embedded Bun
runtime and of the bundled npm dependencies):

- `neoj-<version>-linux-x64.zip`
- `neoj-<version>-linux-arm64.zip`
- `neoj-<version>-darwin-x64.zip`
- `neoj-<version>-darwin-arm64.zip`
- `neoj-<version>-windows-x64.zip`

Download the matching archive, extract it, make the binary executable, and
place it on your `PATH`:

```bash
unzip neoj-<version>-linux-x64.zip
chmod +x neoj-<version>-linux-x64/neoj
mv neoj-<version>-linux-x64/neoj ~/bin/neoj
```

On macOS, the first run may be blocked by Gatekeeper because the binaries are
unsigned. Remove the quarantine attribute if needed:

```bash
xattr -d com.apple.quarantine ~/bin/neoj
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
