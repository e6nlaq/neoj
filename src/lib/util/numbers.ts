/** Largest number in `values`, without spreading a large array into a call. */
export function maxValue(values: Iterable<number>, fallback = -Infinity): number {
    let maximum = fallback;
    for (const value of values) {
        if (value > maximum) {
            maximum = value;
        }
    }

    return maximum;
}
