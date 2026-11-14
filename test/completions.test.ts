import { describe, expect, it } from "bun:test";

import {
    completionShells,
    generateCompletion,
    getCompletionHints,
    parseCompletionShell,
    renderCompletion,
} from "@/feature/completions";
import { createProgram } from "@/feature/program";
import { buildCompletionModel, commandPathKey, flattenCommands } from "@/lib/util/completion";

function createModel() {
    return buildCompletionModel(createProgram(), getCompletionHints());
}

describe("buildCompletionModel", () => {
    it("lists commands, aliases, and nested platform commands", () => {
        const model = createModel();

        expect(model.name).toBe("neoj");
        expect(model.commands.map((command) => command.name)).toEqual([
            "init",
            "download",
            "open",
            "handmade",
            "generate",
            "login",
            "logout",
            "status",
            "stash",
            "test",
            "run",
            "submit",
            "languages",
            "prune",
            "completions",
        ]);
        expect(model.commands.find((command) => command.name === "download")?.aliases).toEqual([
            "d",
        ]);
        expect(model.commands.find((command) => command.name === "open")?.aliases).toEqual(["o"]);
        expect(model.commands.find((command) => command.name === "handmade")?.aliases).toEqual([
            "h",
        ]);
        expect(model.commands.find((command) => command.name === "generate")?.aliases).toEqual([
            "g",
        ]);
        expect(model.commands.find((command) => command.name === "run")?.aliases).toEqual(["r"]);
        expect(model.commands.find((command) => command.name === "languages")?.aliases).toEqual([
            "langs",
        ]);
        expect(model.commands.find((command) => command.name === "completions")?.aliases).toEqual([
            "completion",
        ]);
        expect(
            model.commands
                .find((command) => command.name === "login")
                ?.commands.map((command) => command.name),
        ).toEqual(["atcoder", "yukicoder", "shareoj", "codeforces"]);
        expect(
            model.commands
                .find((command) => command.name === "stash")
                ?.commands.map((command) => command.name),
        ).toEqual(["save", "list", "apply", "pop", "drop", "clear"]);
    });

    it("attaches platform names to --service and login methods to --method", () => {
        const entries = flattenCommands(createModel());
        const logout = entries.find((entry) => commandPathKey(entry.path) === "logout");
        const service = logout?.command.options.find((option) =>
            option.flags.includes("--service"),
        );
        expect(service?.variadic).toBe(true);
        expect(service?.valueCandidates.map((candidate) => candidate.value)).toEqual([
            "atcoder",
            "yukicoder",
            "shareoj",
            "codeforces",
        ]);

        const yukicoder = entries.find((entry) => commandPathKey(entry.path) === "login yukicoder");
        const method = yukicoder?.command.options.find((option) =>
            option.flags.includes("--method"),
        );
        // The --method hint is shared by every platform, so it lists all
        // platforms' methods.
        expect(method?.valueCandidates.map((candidate) => candidate.value)).toEqual([
            "token",
            "api-key",
            "password",
        ]);

        const shareOj = entries.find((entry) => commandPathKey(entry.path) === "login shareoj");
        const shareOjMethod = shareOj?.command.options.find((option) =>
            option.flags.includes("--method"),
        );
        expect(shareOjMethod?.valueCandidates.map((candidate) => candidate.value)).toEqual([
            "token",
            "api-key",
            "password",
        ]);
    });

    it("attaches the show_stderr modes to --show-stderr", () => {
        const entries = flattenCommands(createModel());
        const test = entries.find((entry) => commandPathKey(entry.path) === "test");
        const showStderr = test?.command.options.find((option) =>
            option.flags.includes("--show-stderr"),
        );

        expect(showStderr?.takesValue).toBe(true);
        expect(showStderr?.valueCandidates.map((candidate) => candidate.value)).toEqual([
            "always",
            "failure",
            "never",
        ]);
    });

    it("lists the valueless --submit flag on test", () => {
        const entries = flattenCommands(createModel());
        const test = entries.find((entry) => commandPathKey(entry.path) === "test");
        const submit = test?.command.options.find((option) => option.flags.includes("--submit"));

        expect(submit?.flags).toEqual(["-s", "--submit"]);
        expect(submit?.takesValue).toBe(false);
    });

    it("attaches supported shell names to the completions argument", () => {
        const completions = createModel().commands.find(
            (command) => command.name === "completions",
        );

        expect(completions?.args.map((argument) => argument.name)).toEqual(["shell"]);
        expect(completions?.args[0]?.candidates.map((candidate) => candidate.value)).toEqual([
            ...completionShells,
        ]);
    });

    it("attaches platform names to the languages argument", () => {
        const languages = createModel().commands.find((command) => command.name === "languages");

        expect(languages?.args.map((argument) => argument.name)).toEqual(["platform"]);
        expect(languages?.args[0]?.candidates.map((candidate) => candidate.value)).toEqual([
            "atcoder",
            "yukicoder",
            "shareoj",
            "codeforces",
        ]);
    });

    it("describes help and version exactly once", () => {
        const model = createModel();
        const versions = model.options.filter((option) => option.flags.includes("--version"));

        expect(versions).toHaveLength(1);
        expect(versions[0]?.description).toBe("Show the version");
        expect(model.options.find((option) => option.flags.includes("--help"))?.description).toBe(
            "Show help",
        );
    });
});

describe("renderCompletion", () => {
    const model = createModel();

    it("renders bash completions for subcommands, aliases, and option values", () => {
        const script = renderCompletion(model, "bash");

        expect(script).toContain("complete -F _neoj_completion neoj");
        expect(script).toContain("d|open|o|handmade|h|generate|g|login");
        expect(script).toContain('"login atcoder"');
        expect(script).toContain('"login yukicoder"');
        expect(script).toContain("token api-key");
        expect(script).toContain("atcoder yukicoder shareoj codeforces");
        expect(script).not.toContain("\u001b");
    });

    it("renders zsh completions that work with compdef and with eval", () => {
        const script = renderCompletion(model, "zsh");

        expect(script.startsWith("#compdef neoj\n")).toBe(true);
        expect(script).toContain("_describe -t commands");
        expect(script).toContain("'atcoder:Log in to AtCoder'");
        expect(script).toContain("_neoj_values_method");
        expect(script).toContain("'token:");
        expect(script).toContain('if [ "${funcstack[1]}" = "_neoj" ]; then');
        expect(script).toContain("compdef _neoj neoj");
    });

    it("renders fish completions with subcommand guards", () => {
        const script = renderCompletion(model, "fish");

        expect(script).toContain("complete -c neoj -f");
        expect(script).toContain("__fish_seen_subcommand_from login");
        expect(script).toContain("-a 'atcoder'");
        expect(script).toContain("-l method");
        expect(script).toContain("-a 'token'");
        expect(script).toContain("__neoj_last_option_is --service");
    });

    it("renders a PowerShell native argument completer", () => {
        const script = renderCompletion(model, "powershell");

        expect(script).toContain("Register-ArgumentCompleter -Native -CommandName neoj");
        expect(script).toContain("CompletionResult]::new('atcoder'");
        expect(script).toContain("CompletionResult]::new('api-key'");
        expect(script).toContain("$tokens[-1] -eq $word");
        expect(script).toContain("$path -in @('login yukicoder')");
    });

    it("ends every script with a newline", () => {
        for (const shell of completionShells) {
            expect(renderCompletion(model, shell).endsWith("\n")).toBe(true);
        }
    });
});

describe("parseCompletionShell", () => {
    it("accepts every supported shell", () => {
        for (const shell of completionShells) {
            expect(parseCompletionShell(shell)).toBe(shell);
        }
    });

    it("names the supported shells for an unsupported value", () => {
        expect(() => parseCompletionShell("tcsh")).toThrow(
            "Unsupported shell: tcsh. Supported shells: bash, zsh, fish, powershell.",
        );
    });
});

describe("generateCompletion", () => {
    it("builds a script from the current program", () => {
        const script = generateCompletion(createProgram(), "bash");

        expect(script).toContain("init");
        expect(script).toContain("completions");
    });

    it("rejects an unsupported shell before building the model", () => {
        expect(() => generateCompletion(createProgram(), "tcsh")).toThrow("Unsupported shell");
    });
});
