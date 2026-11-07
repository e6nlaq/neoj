/** Default cap for a single output stream; a runaway program is stopped instead of buffered forever. */
export const defaultOutputLimitBytes = 8 * 1024 * 1024;

export interface CommandOptions {
    argv: readonly string[];
    cwd: string;
    /** File whose contents are piped to the program's stdin. */
    stdinFile?: string;
    /** Text piped to the program's stdin when `stdinFile` is not set. */
    stdinText?: string;
    /** Wall-clock limit. `0` or `undefined` runs without a limit. */
    timeoutMs?: number;
    outputLimitBytes?: number;
    env?: Record<string, string | undefined>;
}

export interface CommandResult {
    argv: readonly string[];
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    maxRssBytes: number | undefined;
    timedOut: boolean;
    outputLimitExceeded: boolean;
}

/** The command could not be started at all, e.g. the executable is missing. */
export class CommandStartError extends Error {
    override name = "CommandStartError";
}

/** One line of an interactive session, already split from the raw stream. */
export interface InteractiveLine {
    direction: "judge" | "solution";
    text: string;
}

export interface InteractiveCommandOptions {
    solution: { argv: readonly string[]; cwd: string };
    interactor: { argv: readonly string[]; cwd: string };
    /** Wall-clock limit for the solution process alone. */
    solutionTimeoutMs?: number;
    /** Wall-clock limit for the whole session; both processes are killed when it expires. */
    sessionTimeoutMs: number;
    outputLimitBytes?: number;
    env?: Record<string, string | undefined>;
}

export interface InteractiveCommandResult {
    solution: {
        exitCode: number | null;
        signal: string | null;
        timedOut: boolean;
        outputLimitExceeded: boolean;
        maxRssBytes: number | undefined;
        durationMs: number;
        stderr: string;
    };
    interactor: {
        exitCode: number | null;
        signal: string | null;
        outputLimitExceeded: boolean;
        stderr: string;
    };
    /** The whole session hit `sessionTimeoutMs` and both processes were stopped. */
    sessionTimedOut: boolean;
    transcript: readonly InteractiveLine[];
    /** Lines dropped after the transcript cap. */
    transcriptOmitted: number;
}

/** Upper bound on stored transcript lines; the byte cap already bounds each line. */
const defaultTranscriptLineLimit = 10_000;

interface WritablePipe {
    write(chunk: string): unknown;
    flush(): Promise<number>;
    end(): unknown;
}

function killQuietly(process_: Bun.Subprocess<"pipe", "pipe", "pipe">): void {
    try {
        process_.kill(9);
    } catch {
        // The process already exited.
    }
}

function endQuietly(pipe: WritablePipe | undefined): void {
    if (pipe === undefined) {
        return;
    }
    try {
        pipe.end();
    } catch {
        // The pipe is already closed.
    }
}

class Transcript {
    readonly lines: InteractiveLine[] = [];
    omitted = 0;

    constructor(private readonly limit: number) {}

    push(direction: InteractiveLine["direction"], text: string): void {
        if (this.lines.length < this.limit) {
            this.lines.push({ direction, text });
        } else {
            this.omitted += 1;
        }
    }
}

interface PumpOptions {
    limit: number;
    destinationExit: Promise<unknown>;
    isDestinationClosed: () => boolean;
    onOverflow: () => void;
    transcript: Transcript;
    direction: InteractiveLine["direction"];
}

/** Relay one stream into the other process, closing it at EOF. */
async function pumpStream(
    from: ReadableStream<Uint8Array> | undefined,
    to: WritablePipe | undefined,
    options: PumpOptions,
): Promise<void> {
    if (from === undefined || to === undefined) {
        return;
    }

    const reader = from.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let size = 0;
    let overflow = false;

    const flushLines = (final: boolean) => {
        while (true) {
            const index = pending.indexOf("\n");
            if (index < 0) {
                break;
            }
            options.transcript.push(options.direction, pending.slice(0, index).replace(/\r$/u, ""));
            pending = pending.slice(index + 1);
        }
        if (final && pending !== "") {
            options.transcript.push(options.direction, pending.replace(/\r$/u, ""));
            pending = "";
        }
    };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            const nextSize = size + value.byteLength;
            if (nextSize > options.limit) {
                const allowed = Math.max(0, options.limit - size);
                pending += decoder.decode(value.subarray(0, allowed), { stream: true });
                flushLines(false);
                overflow = true;
                options.onOverflow();
                break;
            }

            size = nextSize;
            const text = decoder.decode(value, { stream: true });
            pending += text;
            flushLines(false);

            if (text !== "") {
                try {
                    to.write(text);
                    // A dead destination must not leave the pump waiting forever.
                    await Promise.race([to.flush(), options.destinationExit]);
                } catch {
                    break;
                }
            }
            if (options.isDestinationClosed()) {
                break;
            }
        }

        pending += decoder.decode();
        flushLines(true);
    } finally {
        try {
            await reader.cancel();
        } catch {
            // The stream is already closed.
        }
        if (!overflow) {
            endQuietly(to);
        }
    }
}

/**
 * Run a solution and an interactor at the same time, relaying each one's
 * standard output into the other's standard input.
 *
 * Both sides are stopped when the session limit expires, when either output
 * stream floods the cap, or when the solution hits its own time limit.
 */
export async function runInteractiveCommand(
    options: InteractiveCommandOptions,
): Promise<InteractiveCommandResult> {
    if (options.solution.argv.length === 0 || options.interactor.argv.length === 0) {
        throw new CommandStartError("Cannot run an empty command.");
    }

    const limit = options.outputLimitBytes ?? defaultOutputLimitBytes;
    const startedAt = performance.now();
    let solutionTimedOut = false;
    let sessionTimedOut = false;
    let solutionOutputLimitExceeded = false;
    let interactorOutputLimitExceeded = false;

    const spawn = (
        argv: readonly string[],
        cwd: string,
    ): Bun.Subprocess<"pipe", "pipe", "pipe"> => {
        try {
            return Bun.spawn([...argv], {
                cwd,
                stdin: "pipe",
                stdout: "pipe",
                stderr: "pipe",
                env: options.env ?? process.env,
            });
        } catch (error) {
            throw new CommandStartError(
                `Failed to start "${argv[0]}": ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
            );
        }
    };

    const solution = spawn(options.solution.argv, options.solution.cwd);
    let interactor: Bun.Subprocess<"pipe", "pipe", "pipe">;
    try {
        interactor = spawn(options.interactor.argv, options.interactor.cwd);
    } catch (error) {
        killQuietly(solution);
        throw error;
    }

    let solutionClosed = false;
    let interactorClosed = false;
    let solutionDurationMs = 0;
    // The pumps close the other stdin at EOF, after the last buffered bytes.
    // These promises only mark a dead destination so a write cannot hang.
    const solutionExit = solution.exited.then((code) => {
        solutionClosed = true;
        solutionDurationMs = performance.now() - startedAt;
        return code;
    });
    const interactorExit = interactor.exited.then((code) => {
        interactorClosed = true;
        return code;
    });

    const killBoth = () => {
        killQuietly(solution);
        killQuietly(interactor);
    };

    const solutionTimer =
        options.solutionTimeoutMs !== undefined && options.solutionTimeoutMs > 0
            ? setTimeout(() => {
                  solutionTimedOut = true;
                  killQuietly(solution);
              }, options.solutionTimeoutMs)
            : undefined;
    const sessionTimer =
        options.sessionTimeoutMs > 0
            ? setTimeout(() => {
                  sessionTimedOut = true;
                  killBoth();
              }, options.sessionTimeoutMs)
            : undefined;

    const transcript = new Transcript(defaultTranscriptLineLimit);
    const onSolutionOverflow = () => {
        solutionOutputLimitExceeded = true;
        killBoth();
    };
    const onInteractorOverflow = () => {
        interactorOutputLimitExceeded = true;
        killBoth();
    };

    const solutionStderr = captureStream(solution.stderr, limit, onSolutionOverflow);
    const interactorStderr = captureStream(interactor.stderr, limit, onInteractorOverflow);
    const solutionToInteractor = pumpStream(
        solution.stdout,
        interactor.stdin as unknown as WritablePipe,
        {
            limit,
            destinationExit: interactorExit,
            isDestinationClosed: () => interactorClosed,
            onOverflow: onSolutionOverflow,
            transcript,
            direction: "solution",
        },
    );
    const interactorToSolution = pumpStream(
        interactor.stdout,
        solution.stdin as unknown as WritablePipe,
        {
            limit,
            destinationExit: solutionExit,
            isDestinationClosed: () => solutionClosed,
            onOverflow: onInteractorOverflow,
            transcript,
            direction: "judge",
        },
    );

    let solutionExitCode: number | null = null;
    let interactorExitCode: number | null = null;
    try {
        [, , solutionExitCode, interactorExitCode] = await Promise.all([
            solutionToInteractor,
            interactorToSolution,
            solutionExit,
            interactorExit,
        ]);
    } finally {
        if (solutionTimer !== undefined) {
            clearTimeout(solutionTimer);
        }
        if (sessionTimer !== undefined) {
            clearTimeout(sessionTimer);
        }
    }

    const durationMs = solutionDurationMs > 0 ? solutionDurationMs : performance.now() - startedAt;
    const [solutionStderrResult, interactorStderrResult] = await Promise.all([
        solutionStderr,
        interactorStderr,
    ]);

    let maxRssBytes: number | undefined;
    try {
        const usage = solution.resourceUsage();
        if (usage !== undefined && typeof usage.maxRSS === "number" && usage.maxRSS > 0) {
            maxRssBytes = usage.maxRSS;
        }
    } catch {
        // Resource usage is unavailable on some platforms; the limit is skipped.
    }

    return {
        solution: {
            exitCode: solutionExitCode,
            signal: solution.signalCode === null ? null : String(solution.signalCode),
            timedOut: solutionTimedOut,
            outputLimitExceeded: solutionOutputLimitExceeded || solutionStderrResult.overflow,
            maxRssBytes,
            durationMs,
            stderr: solutionStderrResult.text,
        },
        interactor: {
            exitCode: interactorExitCode,
            signal: interactor.signalCode === null ? null : String(interactor.signalCode),
            outputLimitExceeded: interactorOutputLimitExceeded || interactorStderrResult.overflow,
            stderr: interactorStderrResult.text,
        },
        sessionTimedOut,
        transcript: transcript.lines,
        transcriptOmitted: transcript.omitted,
    };
}

interface CapturedStream {
    text: string;
    overflow: boolean;
}

async function captureStream(
    stream: ReadableStream<Uint8Array> | undefined,
    limit: number,
    onOverflow: () => void,
): Promise<CapturedStream> {
    if (stream === undefined) {
        return { text: "", overflow: false };
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let size = 0;
    let overflow = false;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            const nextSize = size + value.byteLength;
            if (nextSize > limit) {
                const allowed = Math.max(0, limit - size);
                text += decoder.decode(value.subarray(0, allowed), { stream: true });
                overflow = true;
                onOverflow();
                await reader.cancel();
                break;
            }

            size = nextSize;
            text += decoder.decode(value, { stream: true });
        }
    } finally {
        text += decoder.decode();
    }

    return { text, overflow };
}

/**
 * Run one command without a shell, capturing both output streams.
 *
 * The process is killed when it exceeds the time limit or floods an output
 * stream, so a single test case cannot stall or exhaust the CLI.
 */
export async function runCommand(options: CommandOptions): Promise<CommandResult> {
    if (options.argv.length === 0) {
        throw new CommandStartError("Cannot run an empty command.");
    }

    const limit = options.outputLimitBytes ?? defaultOutputLimitBytes;
    const startedAt = performance.now();
    let timedOut = false;
    let outputLimitExceeded = false;

    const stdin =
        options.stdinFile !== undefined
            ? Bun.file(options.stdinFile)
            : options.stdinText === undefined
              ? "ignore"
              : new Blob([options.stdinText]);

    let process_: Bun.Subprocess<"ignore", "pipe", "pipe">;
    try {
        process_ = Bun.spawn([...options.argv], {
            cwd: options.cwd,
            stdin,
            stdout: "pipe",
            stderr: "pipe",
            env: options.env ?? process.env,
        });
    } catch (error) {
        throw new CommandStartError(
            `Failed to start "${options.argv[0]}": ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }

    const terminate = () => {
        try {
            process_.kill(9);
        } catch {
            // The process already exited.
        }
    };

    const timer =
        options.timeoutMs !== undefined && options.timeoutMs > 0
            ? setTimeout(() => {
                  timedOut = true;
                  terminate();
              }, options.timeoutMs)
            : undefined;

    const onOverflow = () => {
        outputLimitExceeded = true;
        terminate();
    };

    const stdout = captureStream(process_.stdout, limit, onOverflow);
    const stderr = captureStream(process_.stderr, limit, onOverflow);

    let exitCode: number | null;
    try {
        exitCode = await process_.exited;
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }

    const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr]);
    const durationMs = performance.now() - startedAt;

    let maxRssBytes: number | undefined;
    try {
        const usage = process_.resourceUsage();
        if (usage !== undefined && typeof usage.maxRSS === "number" && usage.maxRSS > 0) {
            maxRssBytes = usage.maxRSS;
        }
    } catch {
        // Resource usage is unavailable on some platforms; the limit is skipped.
    }

    return {
        argv: options.argv,
        exitCode,
        signal: process_.signalCode === null ? null : String(process_.signalCode),
        stdout: stdoutResult.text,
        stderr: stderrResult.text,
        durationMs,
        maxRssBytes,
        timedOut,
        outputLimitExceeded: outputLimitExceeded || stdoutResult.overflow || stderrResult.overflow,
    };
}
