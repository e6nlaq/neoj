export function hasErrorCode(error: unknown, code: string): boolean {
    return (
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code === code
    );
}

export function isTimeoutError(error: unknown): boolean {
    return (
        (error instanceof Error && error.name === "TimeoutError") ||
        hasErrorCode(error, "ETIMEDOUT")
    );
}
