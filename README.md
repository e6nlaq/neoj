<div align="center">

<p align="center">
    <img src="https://raw.githubusercontent.com/e6nlaq/neoj/main/docs/assets/banner.png" alt="neoj" width="1080">
</p>

<p align="center"><sub>Built with Bun and TypeScript · Open Source</sub></p>

<p align="center">
  <a href="https://npmx.dev/package/@neoj/cli"><img src="https://img.shields.io/npm/v/@neoj/cli?style=flat-square&amp;label=npm&amp;labelColor=24292f&amp;color=24292f" alt="npm version"></a>
  <a href="https://bun.com"><img src="https://img.shields.io/badge/Bun-1.4%2B-24292f?style=flat-square&amp;labelColor=24292f&amp;logo=bun&amp;logoColor=fff" alt="Bun 1.4+"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&amp;labelColor=24292f&amp;logo=typescript&amp;logoColor=fff" alt="TypeScript strict"></a>
  <a href="https://github.com/e6nlaq/neoj/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-24292f?style=flat-square&amp;labelColor=24292f" alt="MIT license"></a>
</p>

<p align="center"><sub><strong>Early development</strong> — commands, configuration, and output formats may change between releases.</sub></p>

</div>

---

`neoj` is a command-line tool for competitive programming workflows, built with
[Bun](https://bun.com) and TypeScript. It aims to be a modern alternative to `oj`:
a clear CLI, a reliable problem workflow, and a consistent interface across
contest platforms.

## Supported services

| Service                 | Sample download (`download`) | Submit (`submit`) | Login / sessions (`login`, `status`) |
| ----------------------- | ---------------------------- | ----------------- | ------------------------------------ |
| AtCoder                 | ✅                           | ✅                | ✅                                   |
| yukicoder               | ✅                           | ✅                | ✅                                   |
| Aizu Online Judge (AOJ) | ✅                           | —                 | —                                    |

AOJ support is download-only for now: samples can be fetched, but submissions
and sessions are not implemented yet.

## Documentation

### Learn

- [Your first problem](https://github.com/e6nlaq/neoj/blob/main/docs/tutorial.md) —
  go from an empty directory to downloaded sample tests.

### Do

- [Install neoj](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/install.md)
- [Set up shell completions](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/setup-completions.md)
- [Set up editor completions](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/setup-editor-completions.md)
- [Log in, check status, and log out](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/manage-sessions.md)
- [Download sample tests](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/download-samples.md)
- [Create a test case by hand](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/create-handmade-tests.md)
- [Generate random test cases](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/generate-random-tests.md)
- [Build and run the sample tests](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/run-tests.md)
- [Run a solution without tests](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/run-a-solution.md)
- [Submit a solution](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/submit-solution.md)
- [Stash and restore work per problem](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/stash-work.md)
- [Configure a project](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/configure-project.md)
- [Contribute](https://github.com/e6nlaq/neoj/blob/main/docs/how-to/contribute.md)

### Look up

- [CLI reference](https://github.com/e6nlaq/neoj/blob/main/docs/reference/cli.md)
- [Configuration reference](https://github.com/e6nlaq/neoj/blob/main/docs/reference/configuration.md)
- [Credential storage](https://github.com/e6nlaq/neoj/blob/main/docs/reference/credentials.md)

### Understand

- [Platforms and integrations](https://github.com/e6nlaq/neoj/blob/main/docs/explanation/platforms.md)
- [Sessions and credential security](https://github.com/e6nlaq/neoj/blob/main/docs/explanation/sessions.md)

## Acknowledgements

`neoj` is inspired by, and learns from, these projects:

- [online-judge-tools/oj](https://github.com/online-judge-tools/oj) — the original `oj` CLI that `neoj` aims to modernize.
- [sevenc-nanashi/competitive-programming-cli(cpg)](https://github.com/sevenc-nanashi/competitive-programming-cli) — a competitive-programming CLI with a similar focus. Inspired by several ideas.

## License

[MIT](https://github.com/e6nlaq/neoj/blob/main/LICENSE)
