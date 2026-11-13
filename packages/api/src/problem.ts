/** The platform and slug that identify a problem across downloads and stashes. */
export interface ProblemKey {
    /** The platform name, such as `atcoder` or `yukicoder`. */
    platform: string;
    /** The platform-specific identifier, unique within `platform`. */
    slug: string;
}

/** One input/output pair from a problem statement. */
export interface ProblemSample {
    /** The sample input. */
    input: string;
    /** The expected output. */
    output: string;
}

/** The problem data shared by every platform client. */
export interface Problem {
    /** The problem URL as it was passed to the client. */
    url: string;
    /** The problem title. */
    title: string;
    /** The samples in statement order. */
    samples: ProblemSample[];
    /**
     * The stable problem key for platforms whose URL does not map to one
     * synchronously (a ShareOJ contest problem URL resolves its problem ID
     * through the API). Callers may fall back to deriving it from `url`.
     */
    key?: ProblemKey;
    // Contest windows are currently recorded for AtCoder only. See AGENTS.md.
    /** The start of the contest that published the problem. */
    startTime?: Temporal.Instant;
    /** The end of the contest that published the problem. */
    endTime?: Temporal.Instant;
}

/** The single operation every platform problem client implements. */
export interface ProblemClient {
    getProblem(url: string): Promise<Problem>;
}
