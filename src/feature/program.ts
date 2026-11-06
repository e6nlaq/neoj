import { Command } from "@commander-js/extra-typings";

import { createCompletionsCommand } from "@/feature/completions";
import { createDownloadCommand } from "@/feature/download";
import { createHandmadeCommand } from "@/feature/handmade";
import { applyHelpBanner } from "@/feature/help-banner";
import { createInitCommand } from "@/feature/init";
import { createLoginCommand } from "@/feature/login";
import { createLogoutCommand } from "@/feature/logout";
import { createOpenCommand } from "@/feature/open";
import { createPruneCommand } from "@/feature/prune";
import { createRunCommand } from "@/feature/run";
import { createStashCommand } from "@/feature/stash";
import { createStatusCommand } from "@/feature/status";
import { createTestCommand } from "@/feature/test";

import { description, version } from "../../package.json";

export function createProgram(): Command {
    const program = new Command();
    program.name("neoj").version(version).description(description);
    applyHelpBanner(program);
    // `neoj run` passes its arguments through to the program, which requires
    // the root command to stop parsing options at the subcommand.
    program.enablePositionalOptions();

    program.addCommand(createInitCommand());
    program.addCommand(createDownloadCommand());
    program.addCommand(createOpenCommand());
    program.addCommand(createHandmadeCommand());
    program.addCommand(createLoginCommand());
    program.addCommand(createLogoutCommand());
    program.addCommand(createStatusCommand());
    program.addCommand(createStashCommand());
    program.addCommand(createTestCommand());
    program.addCommand(createRunCommand());
    program.addCommand(createPruneCommand());
    program.addCommand(createCompletionsCommand(program));

    return program;
}
