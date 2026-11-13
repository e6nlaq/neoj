# API reference

`@neoj/api` is the platform client package behind [`neoj`](https://github.com/e6nlaq/neoj). It
contains the HTTP requests, URL validation, and HTML/JSON parsing of the CLI, so
other tools can use the same clients without installing the CLI. The package
never reads or writes credential files and has no CLI dependencies.

`@neoj/api` is an unofficial client. It is not affiliated with or endorsed by
AtCoder, yukicoder, ShareOJ, Aizu Online Judge, or Codeforces. Use it at your
own risk, and follow each platform's terms of service and rate limits.

The package is ESM-only and requires Node.js 26 or newer. It uses the built-in
`Temporal` API, so TypeScript consumers need `ESNext.Temporal` in their `lib`
(TypeScript 6 or newer, or an equivalent `lib` entry). Bun consumers load the
TypeScript sources directly; Node.js consumers load the compiled ESM build.

## Install and entry points

```bash
npm install @neoj/api
```

| Import                  | Contents                                                     |
| ----------------------- | ------------------------------------------------------------ |
| `@neoj/api`             | Re-exports every module below                                |
| `@neoj/api/atcoder`     | AtCoder problem, language, and submission clients            |
| `@neoj/api/yukicoder`   | yukicoder problem, device-flow login, and submission clients |
| `@neoj/api/shareoj`     | ShareOJ problem, login, runtime, and submission clients      |
| `@neoj/api/aoj`         | AOJ problem client                                           |
| `@neoj/api/codeforces`  | Codeforces problem client                                    |
| `@neoj/api/problem`     | `Problem`, `ProblemSample`, `ProblemKey`, `ProblemClient`    |
| `@neoj/api/problem-key` | `deriveProblemKey`                                           |
| `@neoj/api/errors`      | `isTimeoutError`                                             |
| `@neoj/api/user-agent`  | The `User-Agent` string sent by the clients                  |

## Quick start

```ts
import { AtCoderClient } from "@neoj/api/atcoder";

const problem = await new AtCoderClient().getProblem(
    "https://atcoder.jp/contests/abc001/tasks/abc001_1",
);

console.log(problem.title);
for (const sample of problem.samples) {
    console.log(sample.input);
    console.log(sample.output);
}
```

## Shared types

```ts
interface ProblemKey {
    platform: string;
    slug: string;
}

interface ProblemSample {
    input: string;
    output: string;
}

interface Problem {
    url: string;
    title: string;
    samples: ProblemSample[];
    key?: ProblemKey;
    startTime?: Temporal.Instant;
    endTime?: Temporal.Instant;
}

interface ProblemClient {
    getProblem(url: string): Promise<Problem>;
}
```

`Problem` is the common result shape. Every client preserves the `url` it was
given, so a caller can record the exact URL the user downloaded.

- `samples` are in statement order. Line endings are normalized to `\n`, and a
  trailing newline is removed where the platform would add one.
- `key` is set when the client knows the stable key, which includes every
  ShareOJ problem. It is required when the URL cannot be mapped to a key
  synchronously; a ShareOJ contest problem URL resolves its problem ID through
  the API.
- `startTime` and `endTime` are recorded for AtCoder only. `AtCoderProblem`
  requires both.

## Requests and errors

Every client follows the same rules:

- Requests time out after 15 seconds and are not retried.
- Every request sends `USER_AGENT` (`neoj/<version> (+<repository>)`) so the
  platforms can identify the client.
- Transport failures and timeouts are wrapped in an `Error` whose message names
  the platform. The original error is kept in `cause`.
- URL parsers throw `TypeError` before any request is made when the input is not
  a supported URL.

A non-2xx problem response is reported with a status-carrying error class:

| Platform   | Error                           | Extra fields     |
| ---------- | ------------------------------- | ---------------- |
| AtCoder    | `AtCoderProblemRequestError`    | `status`         |
| yukicoder  | `YukicoderProblemRequestError`  | `status`         |
| AOJ        | `AojProblemRequestError`        | `status`         |
| Codeforces | `CodeforcesProblemRequestError` | `status`         |
| ShareOJ    | `ShareOjApiError`               | `status`, `code` |

`isTimeoutError(error)` recognizes both `AbortSignal.timeout()`'s `TimeoutError`
and transports that report `ETIMEDOUT`.

```ts
import { isTimeoutError } from "@neoj/api/errors";

try {
    await client.getProblem(url);
} catch (error) {
    if (isTimeoutError(error)) {
        // The platform did not answer within 15 seconds.
    }
}
```

## AtCoder

`AtCoderClient` sends an optional `REVEL_SESSION` cookie. The constructor takes
no arguments.

| Member                                   | Returns                            | Description                                                                                       |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `login(revelSession)`                    | `Promise<boolean>`                 | Validates the cookie against `/settings` and keeps it for later requests. `false` means rejected. |
| `csrfToken`                              | `string \| undefined`              | The CSRF token embedded in the session cookie, when present.                                      |
| `username`                               | `string \| undefined`              | The account name read during the last successful `login()`.                                       |
| `getProblem(url)`                        | `Promise<AtCoderProblem>`          | Fetches the task page with its samples and contest window.                                        |
| `getSubmitPage(url)`                     | `Promise<AtCoderSubmitPage>`       | Fetches and caches the submission form for the task.                                              |
| `getLanguages(url)`                      | `Promise<AtCoderLanguage[]>`       | Languages accepted for the task.                                                                  |
| `getLanguagesForContest(contestId)`      | `Promise<AtCoderLanguage[]>`       | Languages of a contest, without a downloaded task.                                                |
| `submit(url, languageId, source, page?)` | `Promise<AtCoderSubmissionResult>` | Posts the source. Pass a cached page to skip the extra request.                                   |

```ts
import { AtCoderClient } from "@neoj/api/atcoder";

const client = new AtCoderClient();
if (!(await client.login(revelSession))) {
    throw new Error("The AtCoder session is not valid.");
}

const problem = await client.getProblem(url);
const result = await client.submit(url, "5001", source);
console.log(result.submissionUrl);
```

`submissionId` is optional. When AtCoder redirects without a submission ID and
the latest submission cannot be read, `submissionUrl` still points at the
submissions list so the caller can report it.

AtCoder shows a Turnstile widget outside contest windows, so automated
submission is only reliable during a contest. `AtCoderSubmitPage.hasTurnstile`
reports whether the form contains the widget, and `submit()` explains the
limitation when the post is rejected.

### AtCoder helpers

| Function                                        | Description                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `parseAtCoderProblemUrl(value)`                 | Validates `/contests/<contestId>/tasks/<taskId>` and returns the URL. |
| `parseAtCoderTask(value)`                       | Returns `{ contestId, taskId }` for a task URL.                       |
| `normalizeRevelSession(value)`                  | Removes an optional `REVEL_SESSION=` prefix and validates the value.  |
| `parseAtCoderUsername(html)`                    | Reads the account name from a page; `undefined` when unreadable.      |
| `buildAtCoderContestUrl(value)`                 | The contest page of a task URL.                                       |
| `buildAtCoderSubmissionsUrl(value)`             | Your submissions for the task.                                        |
| `buildAtCoderSubmitUrl(value)`                  | The submission form with `taskScreenName` preselected.                |
| `parseAtCoderSubmitPage(html, submitUrl, task)` | Parses a submission form into `AtCoderSubmitPage`.                    |
| `parseAtCoderLatestSubmission(html, contestId)` | Reads the newest submission ID from a submissions page.               |

`login()` uses a redirect from `/settings` to `/login` as the signed-out signal.
A page that renders a sign-in form with HTTP 200 would not be detected; the
`username` property would then simply stay `undefined`.

## yukicoder

`YukicoderClient` talks to the public yukicoder API and the problem pages.

| Member                                               | Returns                                   | Description                                                       |
| ---------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `getProblem(url)`                                    | `Promise<YukicoderProblem>`               | Fetches a problem page and parses its samples.                    |
| `requestDeviceCode(clientName)`                      | `Promise<YukicoderDeviceCode>`            | Starts the device authorization flow.                             |
| `pollDeviceToken(deviceCode, options?)`              | `Promise<YukicoderDeviceToken>`           | Polls until the user approves or the code expires.                |
| `getLanguages()`                                     | `Promise<YukicoderLanguage[]>`            | The public language list used by the submission form.             |
| `submit(problemUrl, credential, languageId, source)` | `Promise<YukicoderSubmissionResult>`      | Submits source and returns the new submission.                    |
| `getAuthUser(credential)`                            | `Promise<YukicoderAuthUser \| undefined>` | Reads the account; `undefined` means the credential was rejected. |
| `checkCredential(credential)`                        | `Promise<boolean>`                        | Whether the API accepts the credential.                           |

```ts
import { YukicoderClient } from "@neoj/api/yukicoder";

const client = new YukicoderClient();
const code = await client.requestDeviceCode("neoj");
console.log(`Open ${code.verificationUriComplete}`);

const token = await client.pollDeviceToken(code);
const result = await client.submit(problemUrl, token.accessToken, "1", source);
```

`pollDeviceToken()` honours `authorization_pending` and `slow_down` (adding five
seconds to the interval), and reports `access_denied`, `expired_token`,
`invalid_grant`, and `unsupported_grant_type` with actionable messages. Pass
`options.sleep` and `options.now` in tests to avoid real waiting.

`getProblem()` accepts both `/problems/no/<number>` and `/problems/<id>`. The
submission API needs the problem number, so `submit()` resolves the ID form
through `/v1/problems/<id>` first.

The device-flow token is submit-only. An account API key has broader access and
should be treated like a password; the package accepts either as the
`credential` argument and never stores it.

### yukicoder helpers

| Function                              | Description                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `parseYukicoderProblemUrl(value)`     | Validates a `/problems/no/<n>` or `/problems/<id>` URL.                          |
| `parseYukicoderProblemRoute(value)`   | Returns `{ kind: "no" \| "id", number }`.                                        |
| `normalizeYukicoderCredential(value)` | Removes an optional `Bearer ` prefix and rejects header-unsafe values.           |
| `buildYukicoderSubmissionsUrl(value)` | Your submissions for the problem.                                                |
| `fetchYukicoderContestUrl(value)`     | Resolves the contest page through the public API; fails for standalone problems. |
| `parseYukicoderAuthUser(value)`       | Reads `{ id, name }` from an `/v1/authUser` body, dropping malformed fields.     |

## ShareOJ

`ShareOjClient` uses the official ShareOJ API for problems, authentication,
runtimes, and submissions. Tokens are passed to each call and never stored.

| Member                                              | Returns                                      | Description                                                               |
| --------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| `getProblem(url)`                                   | `Promise<ShareOjProblem>`                    | Fetches a direct or contest problem with its samples and `key`.           |
| `login(username, password)`                         | `Promise<ShareOjTokens \| ShareOjChallenge>` | Starts an email + password login.                                         |
| `continueChallenge(username, challenge, responses)` | `Promise<ShareOjTokens \| ShareOjChallenge>` | Answers an MFA or new-password challenge.                                 |
| `refresh(refreshToken)`                             | `Promise<ShareOjTokens>`                     | Exchanges a refresh token for new tokens.                                 |
| `getMe(token)`                                      | `Promise<string \| undefined>`               | Checks an access token against `/auth/me` and returns the user ID.        |
| `getMyProfile(token)`                               | `Promise<ShareOjProfile \| undefined>`       | Reads the public profile; `undefined` means no profile is registered yet. |
| `getRuntimes()`                                     | `Promise<ShareOjRuntime[]>`                  | The runtimes accepted for submissions.                                    |
| `submit(token, request)`                            | `Promise<ShareOjSubmission>`                 | Submits source; the server accepts it with HTTP 202.                      |

```ts
import { decodeShareOjShortId, ShareOjClient } from "@neoj/api/shareoj";

const client = new ShareOjClient();
const auth = await client.login(email, password);
if ("name" in auth) {
    // Continue the challenge, then retry or finish the login.
} else {
    const problem = await client.getProblem(problemUrl);
    const runtimes = await client.getRuntimes();
    await client.submit(auth.accessToken, {
        // `key.slug` is the short ID; the API wants the UUID.
        problemId: decodeShareOjShortId(problem.key!.slug),
        runtime: runtimes[0]!.id,
        source,
    });
}
```

`getProblem()` accepts a problem page URL, a bare UUID, a bare 22-character
short ID, or a contest problem URL (`/contests/<id>/<label>`). A contest URL is
resolved through `/contests/<uuid>`, so the returned `key` carries the short ID
of the underlying problem; the contest URL itself cannot be mapped offline.

Samples are either inline text or file references. A file must use HTTPS, and
the downloaded bytes are checked against the reported `size` and `sha256`
before they are decoded. Failures use `ShareOjSampleDownloadError`; API
responses use `ShareOjApiError`, which exposes the server's error code when the
body contains one.

### ShareOJ helpers

| Function                                                     | Description                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `parseShareOjProblemUrl(value)`                              | Validates `https://www.share-oj.net/problems/<shortId>`.     |
| `parseShareOjContestProblemUrl(value)`                       | Returns `{ contestShortId, label }`.                         |
| `parseShareOjProblemId(value)`                               | Normalizes a problem URL, UUID, or short ID to the API UUID. |
| `parseShareOjUuid(value)`                                    | Trims and validates a UUID.                                  |
| `decodeShareOjShortId(shortId)`                              | Converts a 22-character short ID to a UUID.                  |
| `encodeShareOjShortId(uuid)`                                 | Converts a UUID to a 22-character short ID.                  |
| `parseShareOjProblemLabel(label)`                            | Converts `A`, `B`, ..., `AA` to a zero-based index.          |
| `encodeShareOjProblemLabel(index)`                           | Converts a zero-based index to a contest label.              |
| `extractShareOjShortId(value)`                               | Returns the short ID of a validated problem URL.             |
| `buildShareOjContestUrl(contestShortId)`                     | The contest page.                                            |
| `buildShareOjProblemSubmissionsUrl(shortId)`                 | Your submissions for a problem.                              |
| `buildShareOjContestSubmissionsUrl(contestShortId, label)`   | Your submissions for one contest problem.                    |
| `buildShareOjSubmissionUrl(submissionUuid, contestShortId?)` | The page shown after a successful submission.                |

## Aizu Online Judge

`AojClient` fetches problems from the v1 statement page, which serves the sample
HTML. The v2 site renders its problem pages client-side.

| Member            | Returns               | Description                                              |
| ----------------- | --------------------- | -------------------------------------------------------- |
| `getProblem(url)` | `Promise<AojProblem>` | Fetches a problem by ID through the v1 description page. |

Accepted URL forms:

- `https://judge.u-aizu.ac.jp/onlinejudge/description.jsp?id=<id>`
- `https://onlinejudge.u-aizu.ac.jp/problems/<id>`
- `https://onlinejudge.u-aizu.ac.jp/courses/lesson/<...>/<id>`

The v1 URL's `lang` parameter selects `ja` or `en`; anything else falls back to
`en`. Only the title changes, because sample headings are English on both
versions.

| Function                                  | Description                                                     |
| ----------------------------------------- | --------------------------------------------------------------- |
| `parseAojProblemId(value)`                | Trims and validates a problem ID such as `ALDS1_1_A` or `0001`. |
| `parseAojProblemUrl(value)`               | Validates any accepted URL form.                                |
| `extractAojProblemId(value)`              | Returns the problem ID of a validated URL.                      |
| `resolveAojPageLanguage(url)`             | Returns `ja` or `en` for a v1 URL.                              |
| `buildAojDescriptionUrl(problemId, lang)` | The v1 statement URL used for the request.                      |
| `parseAojProblem(html, url)`              | Parses a v1 description page into `AojProblem`.                 |

## Codeforces

`CodeforcesClient` fetches problems from the public contest page. Codeforces is
download-only: the package does not log in or submit.

| Member            | Returns                      | Description                                    |
| ----------------- | ---------------------------- | ---------------------------------------------- |
| `getProblem(url)` | `Promise<CodeforcesProblem>` | Fetches a problem page and parses its samples. |

Accepted URL forms:

- `https://codeforces.com/contest/<contestId>/problem/<index>`
- `https://codeforces.com/problemset/problem/<contestId>/<index>`

Gym, group, and mirror URLs are rejected: they need a login or a different
origin.

| Function                               | Description                                              |
| -------------------------------------- | -------------------------------------------------------- |
| `parseCodeforcesProblemUrl(value)`     | Validates one of the two URL forms.                      |
| `extractCodeforcesProblemRoute(value)` | Returns `{ contestId, index }`, with an uppercase index. |
| `buildCodeforcesContestUrl(route)`     | The contest page.                                        |
| `buildCodeforcesProblemUrl(route)`     | The contest-path problem page.                           |
| `stripCodeforcesTitleIndex(title)`     | Removes a leading `B.` style index from a title.         |
| `parseCodeforcesProblem(html, url)`    | Parses a problem page into `CodeforcesProblem`.          |

## Problem keys

`deriveProblemKey(url)` returns the stable `{ platform, slug }` key of a problem
URL without network access.

| Platform   | Slug                                  |
| ---------- | ------------------------------------- |
| AtCoder    | Task ID, such as `abc001_1`           |
| yukicoder  | `no<number>` or `id<number>`          |
| AOJ        | Problem ID, such as `ALDS1_1_A`       |
| Codeforces | Contest ID and index, such as `1234B` |
| ShareOJ    | 22-character short ID                 |

AOJ's v1 and v2 URLs share one slug, as do Codeforces' contest and problemset
URLs, so re-downloading through either form keeps the same key. A ShareOJ
contest problem URL cannot be resolved offline; use the `key` returned by
`ShareOjClient.getProblem()` instead, or the value recorded in
`.neoj/problem.json`.

## Credentials

The package validates credentials but never reads or writes them. Pass the value
from your own storage:

- `normalizeRevelSession()` accepts a cookie value with or without the
  `REVEL_SESSION=` prefix.
- `normalizeYukicoderCredential()` accepts a token or API key with or without
  the `Bearer ` prefix.
- ShareOJ takes an access token or refresh token as a plain string.

Both normalizers reject empty values and characters that cannot be sent in an
HTTP header. Treat every credential as an account secret and keep it out of
logs and error output.

## Related

- [Platforms and integrations](../explanation/platforms.md)
- [Sessions and credential security](../explanation/sessions.md)
- [Credential storage](credentials.md)
- [CLI reference](cli.md)
- [`packages/api/README.md`](https://github.com/e6nlaq/neoj/blob/main/packages/api/README.md)
