# @neoj/api

API clients for the competitive programming platforms supported by
[`neoj`](https://github.com/e6nlaq/neoj). The package contains the HTTP
requests, URL validation, and HTML/JSON parsing of the CLI; it does not read or
write credentials and has no CLI dependencies.

This is an unofficial client. It is not affiliated with or endorsed by AtCoder,
yukicoder, ShareOJ, Aizu Online Judge, or Codeforces. Use it at your own risk,
and follow each platform's terms of service and rate limits.

## Install

```bash
npm install @neoj/api
```

The package is ESM-only and requires Node.js 26 or newer. It uses the built-in
`Temporal` API, so TypeScript consumers need a compiler that includes
`ESNext.Temporal` (TypeScript 6 or newer) or an equivalent `lib` entry.

Bun consumers load the TypeScript sources directly; Node.js consumers load the
compiled ESM build.

## Usage

```ts
import { deriveProblemKey } from "@neoj/api";
import { AtCoderClient } from "@neoj/api/atcoder";

const problem = await new AtCoderClient().getProblem(
    "https://atcoder.jp/contests/abc001/tasks/abc001_1",
);

console.log(problem.title);
console.log(problem.samples);
console.log(deriveProblemKey(problem.url));
```

Every platform has its own subpath:

| Subpath                 | Contents                                                     |
| ----------------------- | ------------------------------------------------------------ |
| `@neoj/api/atcoder`     | AtCoder problem, language, and submission clients            |
| `@neoj/api/yukicoder`   | yukicoder problem, device-flow login, and submission clients |
| `@neoj/api/shareoj`     | ShareOJ problem, login, and submission clients               |
| `@neoj/api/aoj`         | AOJ problem client                                           |
| `@neoj/api/codeforces`  | Codeforces problem, language, and submission clients         |
| `@neoj/api/problem`     | `Problem`, `ProblemSample`, `ProblemKey`, `ProblemClient`    |
| `@neoj/api/problem-key` | `deriveProblemKey`                                           |
| `@neoj/api/errors`      | `isTimeoutError`                                             |
| `@neoj/api/user-agent`  | The `User-Agent` string sent by the clients                  |

The root import re-exports every module.

## Documentation

The [API reference](https://github.com/e6nlaq/neoj/blob/main/docs/reference/api.md)
documents every client, helper function, type, and error class.

## Authentication

The clients accept credentials as arguments (`AtCoderClient.login`,
`CodeforcesClient.login`, `YukicoderClient.checkCredential`,
`ShareOjClient.getMe`, and so on) but never store them. Credential storage
belongs to the CLI.

## Licenses

MIT
