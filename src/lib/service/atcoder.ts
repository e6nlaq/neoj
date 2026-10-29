import { Window } from "happy-dom";

const ATCODER_ORIGIN = "https://atcoder.jp";
const LOGIN_CHECK_URL = `${ATCODER_ORIGIN}/contests/abc100/submit`;

export interface AtCoderSample {
    input: string;
    output: string;
}

export interface AtCoderProblem {
    url: string;
    title: string;
    samples: AtCoderSample[];
    isContestRunning: boolean;
}

function parseProblem(html: string, url: string): AtCoderProblem {
    const window = new Window();
    try {
        window.document.write(html);
        const statement = window.document.querySelector("#task-statement");
        if (!statement) {
            throw new Error("AtCoder problem statement was not found in the response.");
        }

        const title = window.document.title.trim();
        if (!title) {
            throw new Error("AtCoder problem title was not found in the response.");
        }

        const contestTimes = statement.ownerDocument.querySelectorAll(".contest-duration time");
        const startTimeText = contestTimes[0]?.textContent?.trim();
        const endTimeText = contestTimes[contestTimes.length - 1]?.textContent?.trim();
        if (!startTimeText || !endTimeText) {
            throw new Error("AtCoder contest start and end times were not found in the response.");
        }

        const startTime = Date.parse(startTimeText);
        const endTime = Date.parse(endTimeText);
        if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
            throw new Error("AtCoder contest start or end time is invalid.");
        }

        const samples = new Map<number, Partial<AtCoderSample>>();
        for (const heading of statement.querySelectorAll("h3")) {
            const match = heading.textContent
                ?.trim()
                .match(/^(入力例|出力例|Sample Input|Sample Output)\s*(\d+)$/i);
            if (!match) {
                continue;
            }

            const sampleNumber = Number(match[2]);
            const pre = heading.closest(".part")?.querySelector("pre");
            if (!pre) {
                throw new Error(`AtCoder sample ${sampleNumber} content was not found.`);
            }

            const sample = samples.get(sampleNumber) ?? {};
            const value = pre.textContent?.trim() ?? "";
            if (/^(入力例|Sample Input)$/i.test(match[1] ?? "")) {
                sample.input = value;
            } else {
                sample.output = value;
            }
            samples.set(sampleNumber, sample);
        }

        const orderedSamples = [...samples.entries()].sort(([a], [b]) => a - b);
        const resultSamples = orderedSamples.map(([number, sample]) => {
            if (sample.input === undefined || sample.output === undefined) {
                throw new Error(`AtCoder sample ${number} is missing its input or output.`);
            }
            return { input: sample.input, output: sample.output };
        });

        const now = Date.now();
        const isContestRunning =
            new Date(endTime).getUTCFullYear() < 3000 && startTime <= now && now < endTime;

        return { url, title, samples: resultSamples, isContestRunning };
    } finally {
        window.close();
    }
}

export class AtCoderClient {
    private session: string | undefined;
    private csrfTokenValue: string | undefined;

    get csrfToken(): string | undefined {
        return this.csrfTokenValue;
    }

    async login(revelSession: string): Promise<boolean> {
        const session = revelSession.trim().replace(/^REVEL_SESSION=/i, "");
        const decodedSession = decodeURIComponent(session);
        const csrfToken = decodedSession.match(/(?:^|\0)csrf_token:([^\0]*)/i)?.[1];
        this.session = session;
        this.csrfTokenValue = csrfToken || undefined;

        const response = await fetch(LOGIN_CHECK_URL, {
            headers: { Cookie: `REVEL_SESSION=${session}` },
            redirect: "manual",
        });
        const redirected =
            response.redirected ||
            response.type === "opaqueredirect" ||
            (response.status >= 300 && response.status < 400);

        if (redirected || !response.ok) {
            this.session = undefined;
            this.csrfTokenValue = undefined;
            return false;
        }

        return true;
    }

    async getProblem(url: string): Promise<AtCoderProblem> {
        const problemUrl = new URL(url);
        if (
            problemUrl.origin !== ATCODER_ORIGIN ||
            !/^\/contests\/[^/]+\/tasks\/[^/]+\/?$/.test(problemUrl.pathname)
        ) {
            throw new TypeError("Expected an AtCoder contest task URL.");
        }

        const headers = new Headers();
        if (this.session !== undefined) {
            headers.set("Cookie", `REVEL_SESSION=${this.session}`);
        }

        const response = await fetch(problemUrl, { headers, redirect: "manual" });
        if (response.status >= 300 && response.status < 400) {
            throw new Error(`AtCoder redirected the problem request (${response.status}).`);
        }
        if (!response.ok) {
            throw new Error(`AtCoder problem request failed (${response.status}).`);
        }

        const html = await response.text();
        return parseProblem(html, problemUrl.href);
    }
}
