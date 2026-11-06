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
    let done = 0;
    let drawn = false;

    function render(detail: string | undefined): string {
        const columns = stream.columns === undefined ? 80 : Math.max(20, stream.columns);
        const ratio = total === 0 ? 1 : Math.min(1, done / total);
        const counter = `${done}/${total}`;
        const suffix = detail === undefined || detail === "" ? "" : ` ${detail}`;
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
