import { Command } from "@commander-js/extra-typings";
import { consola } from "consola";

import { renderBashCompletion } from "@/feature/completions/bash";
import { renderFishCompletion } from "@/feature/completions/fish";
import { renderPowerShellCompletion } from "@/feature/completions/powershell";
import { renderZshCompletion } from "@/feature/completions/zsh";
import { yukicoderLoginMethods } from "@/feature/login/yukicoder";
import { platforms } from "@/feature/platforms";
import {
    buildCompletionModel,
    type CompletionCandidate,
    type CompletionHints,
    type CompletionModel,
} from "@/lib/util/completion";

export const completionShells = ["bash", "zsh", "fish", "powershell"] as const;

export type CompletionShell = (typeof completionShells)[number];

const shellDescriptions: Record<CompletionShell, string> = {
    bash: "Bash",
    zsh: "Zsh",
    fish: "Fish",
    powershell: "PowerShell",
};

const methodDescriptions: Record<string, string> = {
    token: "Authenticate with a browser device flow token",
    "api-key": "Authenticate with a profile API key",
};

function platformCandidates(): CompletionCandidate[] {
    return platforms.map((platform) => ({
        value: platform.name,
        description: platform.displayName,
    }));
}

export function getCompletionHints(): CompletionHints {
    return {
        optionValues: {
            "--service": platformCandidates(),
            "--method": yukicoderLoginMethods.map((method) => ({
                value: method,
                description: methodDescriptions[method] ?? method,
            })),
        },
        argumentValues: {
            "completions:shell": completionShells.map((shell) => ({
                value: shell,
                description: shellDescriptions[shell],
            })),
        },
    };
}

export function renderCompletion(model: CompletionModel, shell: CompletionShell): string {
    switch (shell) {
        case "bash":
            return renderBashCompletion(model);
        case "zsh":
            return renderZshCompletion(model);
        case "fish":
            return renderFishCompletion(model);
        case "powershell":
            return renderPowerShellCompletion(model);
    }
}

export function parseCompletionShell(value: string): CompletionShell {
    const shell = completionShells.find((candidate) => candidate === value);
    if (shell !== undefined) {
        return shell;
    }

    throw new Error(
        `Unsupported shell: ${value}. Supported shells: ${completionShells.join(", ")}.`,
    );
}

export function generateCompletion(program: Command, shell: string): string {
    const parsedShell = parseCompletionShell(shell);
    const model = buildCompletionModel(program, getCompletionHints());
    return renderCompletion(model, parsedShell);
}

export function createCompletionsCommand(program: Command): Command<[string]> {
    return new Command("completions")
        .alias("completion")
        .description("Generate a shell completion script")
        .argument("<shell>", `Shell to generate completions for (${completionShells.join(", ")})`)
        .action((shell) => {
            try {
                process.stdout.write(generateCompletion(program, shell));
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
}
