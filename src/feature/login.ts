import { Command, Option } from "@commander-js/extra-typings";
import { consola } from "consola";

import { platforms, type LoginSession, type PlatformLoginOptions } from "@/feature/platforms";
import { sanitizeForTerminal } from "@/lib/util/ansi";

/** The output channels used to report a login, injectable for tests. */
export interface LoginReporter {
    info(message: string): void;
    success(message: string): void;
    warn(message: string): void;
}

/**
 * Report one finished login.
 *
 * The account name is optional: a platform may save a valid session without
 * being able to report which account it belongs to, so that case still counts
 * as success and only warns about the missing name.
 */
export function reportLoginResult(
    displayName: string,
    result: LoginSession | undefined,
    reporter: LoginReporter = consola,
): void {
    if (result === undefined) {
        reporter.info("Login cancelled.");
        return;
    }

    const username = result.username === undefined ? "" : sanitizeForTerminal(result.username);
    if (username === "") {
        reporter.success(`Logged in to ${displayName}.`);
        reporter.warn(`Could not read your ${displayName} username. The session is still saved.`);
        return;
    }

    reporter.success(`Logged in to ${displayName} as ${username}.`);
}

export function createLoginCommand(): Command {
    const login = new Command("login").description("Log in to a competitive programming platform");

    for (const provider of platforms) {
        const command = login.command(provider.name).description(provider.description);
        for (const loginOption of provider.loginOptions) {
            const option = new Option(loginOption.flags, loginOption.description);
            if (loginOption.defaultValue !== undefined) {
                option.default(loginOption.defaultValue);
            }
            command.addOption(option);
        }

        command.action(async (options) => {
            try {
                reportLoginResult(
                    provider.displayName,
                    await provider.login(options as PlatformLoginOptions),
                );
            } catch (error) {
                consola.error(error instanceof Error ? error.message : String(error));
                process.exitCode = 1;
            }
        });
    }

    return login;
}
