import { createAnsiStyles } from "@/lib/util/ansi";

/** The subset of a writable stream the progress bar needs. */
export interface ProgressStream {
    write(chunk: string): unknown;
    isTTY?: boolean;
    columns?: number;
}

export interface ProgressBarOptions {
    total: number;
    label?: string;
    stream?: ProgressStream;
    /** Draw the bar even though `--no-progress` was passed. */
    enabled?: boolean;
    /** Monotonic clock in milliseconds; injectable for deterministic tests. */
    now?: () => number;
}

export interface ProgressBar {
    readonly enabled: boolean;
    /** Redraw the bar with an absolute progress count. */
    update(done: number, detail?: string): void;
    /** Add one to the current progress count. */
    advance(detail?: string): void;
    /** Write a line without breaking the bar; plain output when disabled. */
    line(text: string): void;
    /** Erase the bar so the final report starts on a clean line. */
    finish(): void;
}

const minimumBarWidth = 10;
const maximumBarWidth = 30;

/** Render a remaining duration as `42s`, `1m23s`, or `1h02m`. */
export function formatEta(remainingMs: number): string {
    const totalSeconds = Math.max(0, Math.round(remainingMs / 1000));
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) {
        return `${minutes}m${String(totalSeconds % 60).padStart(2, "0")}s`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * A single-line progress bar on stderr. Callers keep their own counters and
 * pass them through `detail`; this helper only knows about `done` and `total`.
 */
export function createProgressBar(options: ProgressBarOptions): ProgressBar {
    const stream = options.stream ?? process.stderr;
    const label = options.label === undefined ? "" : `${options.label} `;
    const total = Math.max(0, options.total);
    const enabled = options.enabled !== false && stream.isTTY === true;
    const styles = createAnsiStyles(enabled);
    const now = options.now ?? (() => performance.now());
    const startedAtMs = now();
    let done = 0;
    let drawn = false;

    function render(detail: string | undefined): string {
        const columns = stream.columns === undefined ? 80 : Math.max(20, stream.columns);
        const ratio = total === 0 ? 1 : Math.min(1, done / total);
        const counter = `${done}/${total}`;
        const parts: string[] = [];
        if (detail !== undefined && detail !== "") {
            parts.push(detail);
        }
        // The rate estimate needs at least one finished item, and nothing is
        // left to estimate once every item is done.
        if (done > 0 && done < total) {
            const elapsedMs = now() - startedAtMs;
            const remainingMs = (elapsedMs / done) * (total - done);
            parts.push(`eta ${formatEta(remainingMs)}`);
        }
        const suffix = parts.length === 0 ? "" : ` ${parts.join(" ")}`;
        const fixedWidth = label.length + counter.length + suffix.length + 6;
        const barWidth = Math.max(minimumBarWidth, Math.min(maximumBarWidth, columns - fixedWidth));
        const filled = Math.round(ratio * barWidth);

        const bar = `${styles.green("█".repeat(filled))}${styles.dim("░".repeat(barWidth - filled))}`;
        return `\r${label}[${bar}] ${counter}${suffix}\u001B[K`;
    }

    function redraw(detail?: string): void {
        if (!enabled) {
            return;
        }

        stream.write(render(detail));
        drawn = true;
    }

    return {
        enabled,
        update(nextDone, detail) {
            done = Math.max(0, Math.min(total, nextDone));
            redraw(detail);
        },
        advance(detail) {
            done = Math.min(total, done + 1);
            redraw(detail);
        },
        line(text) {
            if (!enabled) {
                stream.write(`${text}\n`);
                return;
            }

            stream.write(`\r\u001B[K${text}\n`);
            redraw();
        },
        finish() {
            if (enabled && drawn) {
                stream.write("\r\u001B[K");
            }
            drawn = false;
        },
    };
}
