export interface ProblemKey {
    platform: string;
    slug: string;
}

export interface ProblemSample {
    input: string;
    output: string;
}

export interface Problem {
    url: string;
    title: string;
    samples: ProblemSample[];
    /**
     * The stable problem key for platforms whose URL does not map to one
     * synchronously (a ShareOJ contest problem URL resolves its problem ID
     * through the API). Callers may fall back to deriving it from `url`.
     */
    key?: ProblemKey;
    // Contest windows are currently recorded for AtCoder only. See AGENTS.md.
    startTime?: Temporal.Instant;
    endTime?: Temporal.Instant;
}

export interface ProblemClient {
    getProblem(url: string): Promise<Problem>;
}
