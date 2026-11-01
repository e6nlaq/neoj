import { Command } from "@commander-js/extra-typings";

import { createCompletionsCommand } from "@/feature/completions";
import { createDownloadCommand } from "@/feature/download";
import { applyHelpBanner } from "@/feature/help-banner";
import { createInitCommand } from "@/feature/init";
import { createLoginCommand } from "@/feature/login";
import { createLogoutCommand } from "@/feature/logout";
import { createStatusCommand } from "@/feature/status";

import { description, version } from "../../package.json";

export function createProgram(): Command {
    const program = new Command();
    program.name("neoj").version(version).description(description);
    applyHelpBanner(program);

    program.addCommand(createInitCommand());
    program.addCommand(createDownloadCommand());
    program.addCommand(createLoginCommand());
    program.addCommand(createLogoutCommand());
    program.addCommand(createStatusCommand());
    program.addCommand(createCompletionsCommand(program));

    return program;
}
