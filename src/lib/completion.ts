import type { CommandUnknownOpts, Option } from "@commander-js/extra-typings";

export interface CompletionCandidate {
    value: string;
    description?: string;
}

export interface CompletionOption {
    flags: readonly string[];
    description: string;
    takesValue: boolean;
    variadic: boolean;
    valueCandidates: readonly CompletionCandidate[];
}

export interface CompletionArgument {
    name: string;
    description: string;
    required: boolean;
    variadic: boolean;
    candidates: readonly CompletionCandidate[];
}

export interface CompletionCommand {
    name: string;
    aliases: readonly string[];
    description: string;
    options: readonly CompletionOption[];
    args: readonly CompletionArgument[];
    commands: readonly CompletionCommand[];
}

/** The completion data for a whole program, rooted at the program itself. */
export interface CompletionModel extends CompletionCommand {}

/**
 * Static values that cannot be derived from the Commander command tree, keyed
 * by long option flag and by `command path:argument name`.
 */
export interface CompletionHints {
    optionValues?: Readonly<Record<string, readonly CompletionCandidate[]>>;
    argumentValues?: Readonly<Record<string, readonly CompletionCandidate[]>>;
}

export interface CompletionCommandEntry {
    command: CompletionCommand;
    /** Canonical command names from the root, e.g. `["login", "yukicoder"]`. */
    path: readonly string[];
}

const helpOption: CompletionOption = {
    flags: ["-h", "--help"],
    description: "Show help",
    takesValue: false,
    variadic: false,
    valueCandidates: [],
};

const versionOption: CompletionOption = {
    flags: ["-V", "--version"],
    description: "Show the version",
    takesValue: false,
    variadic: false,
    valueCandidates: [],
};

function optionFlags(option: Option): string[] {
    const flags: string[] = [];
    if (option.short !== undefined) {
        flags.push(option.short);
    }
    if (option.long !== undefined) {
        flags.push(option.long);
    }
    return flags;
}

function optionHintKey(option: Option): string {
    return option.long ?? option.short ?? option.flags;
}

function collectOptions(command: CommandUnknownOpts, hints: CompletionHints): CompletionOption[] {
    const options: CompletionOption[] = [];
    for (const option of command.options) {
        if (option.hidden) {
            continue;
        }

        const flags = optionFlags(option);
        if (flags.length === 0) {
            continue;
        }

        options.push({
            flags,
            description: option.description,
            takesValue: option.required || option.optional,
            variadic: option.variadic,
            valueCandidates: hints.optionValues?.[optionHintKey(option)] ?? [],
        });
    }

    if (!options.some((option) => option.flags.includes("--help"))) {
        options.push(helpOption);
    }

    return dedupeOptions(options);
}

function dedupeOptions(options: readonly CompletionOption[]): CompletionOption[] {
    const seen = new Set<string>();
    return options.filter((option) => {
        const key = option.flags.join(",");
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function collectArguments(
    command: CommandUnknownOpts,
    path: readonly string[],
    hints: CompletionHints,
): CompletionArgument[] {
    return command.registeredArguments.map((argument) => ({
        name: argument.name(),
        description: argument.description,
        required: argument.required,
        variadic: argument.variadic,
        candidates: hints.argumentValues?.[[...path, argument.name()].join(":")] ?? [],
    }));
}

function collectCommand(
    command: CommandUnknownOpts,
    path: readonly string[],
    hints: CompletionHints,
): CompletionCommand {
    return {
        name: command.name(),
        aliases: command.aliases(),
        description: command.description(),
        options: collectOptions(command, hints),
        args: collectArguments(command, path, hints),
        commands: command.commands.map((child) =>
            collectCommand(child, [...path, child.name()], hints),
        ),
    };
}

export function buildCompletionModel(
    program: CommandUnknownOpts,
    hints: CompletionHints = {},
): CompletionModel {
    const options = collectOptions(program, hints).filter(
        (option) => !option.flags.includes("--version"),
    );

    return {
        name: program.name(),
        aliases: [],
        description: program.description(),
        options: [...options, versionOption],
        args: collectArguments(program, [], hints),
        commands: program.commands.map((command) =>
            collectCommand(command, [command.name()], hints),
        ),
    };
}

export function flattenCommands(model: CompletionModel): CompletionCommandEntry[] {
    const entries: CompletionCommandEntry[] = [];
    const visit = (command: CompletionCommand, path: readonly string[]) => {
        entries.push({ command, path });
        for (const child of command.commands) {
            visit(child, [...path, child.name]);
        }
    };

    visit(model, []);
    return entries;
}

export function commandPathKey(path: readonly string[]): string {
    return path.join(" ");
}

/**
 * Every way the command at `entry.path` can be reached, including aliases of
 * its last segment, e.g. `download` and `d`.
 */
export function commandPathKeys(entry: CompletionCommandEntry): string[] {
    if (entry.path.length === 0) {
        return [""];
    }

    const parent = entry.path.slice(0, -1);
    const names = [entry.command.name, ...entry.command.aliases];
    return names.map((name) => commandPathKey([...parent, name]));
}

/** Options that have a fixed set of values, deduplicated by their flags. */
export function collectValueOptions(model: CompletionModel): CompletionOption[] {
    const seen = new Set<string>();
    const options: CompletionOption[] = [];
    for (const { command } of flattenCommands(model)) {
        for (const option of command.options) {
            const key = option.flags.join(",");
            if (option.valueCandidates.length === 0 || seen.has(key)) {
                continue;
            }
            seen.add(key);
            options.push(option);
        }
    }

    return options;
}

export function commandCandidates(command: CompletionCommand): CompletionCandidate[] {
    const subcommands = command.commands.flatMap((child) => [
        { value: child.name, description: child.description },
        ...child.aliases.map((alias) => ({ value: alias, description: child.description })),
    ]);
    const options = command.options.flatMap((option) =>
        option.flags.map((flag) => ({ value: flag, description: option.description })),
    );
    const args = command.args.flatMap((argument) => argument.candidates);

    return [...subcommands, ...options, ...args];
}
