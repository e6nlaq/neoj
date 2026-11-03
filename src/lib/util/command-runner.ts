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
