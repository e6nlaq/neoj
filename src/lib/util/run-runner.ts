/** neoj options that `run` accepts before the source file. */
const booleanRunOptions = new Set(["--cache", "--no-cache", "--silent"]);
const valueRunOptions = new Set(["-l", "--language"]);

export interface SplitRunArguments {
    /** The positional source file, undefined when the program args start at `--`. */
    source: string | undefined;
    /** Everything passed to the program verbatim. */
    programArgs: string[];
}

/**
 * Split the arguments of `neoj run` into a source file and program arguments.
 *
 * Everything after the first positional argument goes to the program, so
 * `neoj run main -x` forwards `-x`. A `--` before the source selects
 * `test.source` and forwards everything after it: `neoj run -- -x`.
 */
export function splitRunArguments(argv: readonly string[]): SplitRunArguments {
    let index = 0;
    while (index < argv.length) {
        const argument = argv[index]!;
        if (argument === "--") {
            return { source: undefined, programArgs: argv.slice(index + 1) };
        }
        if (booleanRunOptions.has(argument)) {
            index += 1;
            continue;
        }
        if (valueRunOptions.has(argument)) {
            index += 2;
            continue;
        }
        if (
            argument.startsWith("--language=") ||
            (argument.startsWith("-l") && argument.length > 2)
        ) {
            index += 1;
            continue;
        }

        break;
    }

    if (index >= argv.length) {
        return { source: undefined, programArgs: [] };
    }

    const source = argv[index]!;
    const rest = argv.slice(index + 1);
    const separator = rest.indexOf("--");
    return {
        source,
        programArgs:
            separator === -1 ? rest : [...rest.slice(0, separator), ...rest.slice(separator + 1)],
    };
}

export interface RunProgramOptions {
    argv: readonly string[];
    cwd: string;
    /**
     * How the program's standard streams are connected. Defaults to `inherit`
     * so interactive input and colored output reach the user unchanged.
     */
    stdio?: "inherit" | "ignore";
    /** Receives the one-line notice when the program was killed by a signal. */
    onSignal?: (message: string) => void;
}

export interface RunProgramResult {
    /** Exit code for neoj: the program's own code, or `1` when a signal killed it. */
    exitCode: number;
    signal: string | null;
}

/**
 * Run the built program with the terminal attached and wait for it to finish.
 *
 * There is no time limit, memory limit, or output cap: the program owns the
 * streams until it exits.
 */
export async function runProgram(options: RunProgramOptions): Promise<RunProgramResult> {
    const stdio = options.stdio ?? "inherit";

    let child: Bun.Subprocess;
    try {
        child = Bun.spawn([...options.argv], {
            cwd: options.cwd,
            stdin: stdio,
            stdout: stdio,
            stderr: stdio,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to start the program: ${message}`, { cause: error });
    }

    const exitCode = await child.exited;
    const signal = child.signalCode == null ? null : String(child.signalCode);
    if (signal !== null) {
        options.onSignal?.(`Killed by ${signal}.`);
        return { exitCode: 1, signal };
    }

    return { exitCode, signal };
}
