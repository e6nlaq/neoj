export interface ProblemSample {
    input: string;
    output: string;
}

export interface Problem {
    url: string;
    title: string;
    samples: ProblemSample[];
    // Contest windows are currently recorded for AtCoder only. See AGENTS.md.
    startTime?: Temporal.Instant;
    endTime?: Temporal.Instant;
}

export interface ProblemClient {
    getProblem(url: string): Promise<Problem>;
}
