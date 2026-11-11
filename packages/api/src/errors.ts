/**
 * Whether a failed request timed out.
 *
 * `AbortSignal.timeout` rejects with a `TimeoutError`, while some transports
 * report `ETIMEDOUT` instead.
 */
export function isTimeoutError(error: unknown): boolean {
    return (
        (error instanceof Error && error.name === "TimeoutError") ||
        (error instanceof Error &&
            "code" in error &&
            typeof error.code === "string" &&
            error.code === "ETIMEDOUT")
    );
}
