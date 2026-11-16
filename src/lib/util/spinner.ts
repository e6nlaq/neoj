import { type OutputStream, Spinner as PicoSpinner } from "picospinner";

import { createAnsiStyles } from "@/lib/util/ansi";
import type { ProgressStream } from "@/lib/util/progress";

export interface SpinnerOptions {
    /** Message shown next to the animated frame. */
    text: string;
    /** Where the spinner draws; defaults to standard error. */
    stream?: ProgressStream;
    /** Defaults to whether `stream` is an interactive terminal. */
    enabled?: boolean;
}

export interface Spinner {
    /** Whether the spinner actually draws anything. */
    readonly enabled: boolean;
    /** Remove the spinner line and stop animating. */
    stop(): void;
}

/**
 * Start a spinner that removes itself when `stop()` is called.
 *
 * A pipe would receive cursor-movement sequences instead of readable output, so
 * the spinner only draws on an interactive terminal. The caller prints the
 * result itself, which keeps the finished line free of the animation.
 */
export function createSpinner(options: SpinnerOptions): Spinner {
    const stream = options.stream ?? process.stderr;
    const enabled = options.enabled !== false && stream.isTTY === true;
    if (!enabled) {
        return { enabled: false, stop() {} };
    }

    const styles = createAnsiStyles(true);
    const spinner = new PicoSpinner(
        {
            text: styles.dim(options.text),
            // picospinner types the stream as a Writable; writing is all neoj needs.
            stream: stream as unknown as OutputStream,
        },
        { colors: false },
    );
    spinner.start();
    let stopped = false;

    return {
        enabled: true,
        stop() {
            if (stopped) {
                return;
            }
            stopped = true;
            spinner.stop();
        },
    };
}

/** Run `task` with a spinner that is removed whichever way the task settles. */
export async function withSpinner<T>(options: SpinnerOptions, task: () => Promise<T>): Promise<T> {
    const spinner = createSpinner(options);
    try {
        return await task();
    } finally {
        spinner.stop();
    }
}

export interface SpinnerSequence {
    /** Show a spinner with this message, replacing any previous one. */
    start(text: string): void;
    /** Remove the current spinner line. */
    end(): void;
}

/**
 * One spinner reused for sequential steps, such as building several programs.
 *
 * Starting a new step removes the previous line, so a caller that reports each
 * step through `start` never leaves a stale message behind.
 */
export function createSpinnerSequence(stream: ProgressStream, enabled = true): SpinnerSequence {
    let current: Spinner | undefined;

    return {
        start(text) {
            current?.stop();
            current = createSpinner({ text, stream, enabled });
        },
        end() {
            current?.stop();
            current = undefined;
        },
    };
}
