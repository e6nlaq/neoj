# Getting started

Install the published npm package globally:

```bash
# Use Bun (recommended)
bun install -g neo-oj

# or use npm
npm install -g neo-oj
```

`neoj` requires [Bun](https://bun.com) 1.4 or newer at runtime. Install Bun if it
is not already available, then verify the CLI:

```bash
neoj --help
```

## Quick start

```bash
# Copy the project templates into the current directory
neoj init

# Save a session for a platform
neoj login atcoder

# Check that the saved session is still valid
neoj status

# Download the sample tests for a problem
neoj d https://atcoder.jp/contests/abc300/tasks/abc300_a
```

## Where to go next

- [Platforms](platforms.md) — how integrations are selected, and how sessions are
  stored.
- [Commands](commands.md) — every command, flag, and generated file.
- [Configuration](configuration.md) — global and project `neoj.toml` options.
- [Development](development.md) — build, test, and contribute.
