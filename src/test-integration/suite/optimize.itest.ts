import * as assert from "assert";
import * as vscode from "vscode";
import { DiagnosticInjector, WorkspaceSettings, corpusMessage, countOccurrences, openFixture, runOptimizeImports, sleep } from "./helpers";

describe("Optimize Imports (playbook T5)", () => {
    it("consolidates, dedupes, and adds missing imports atomically; local-scope using untouched", async () => {
        const settings = new WorkspaceSettings();
        await settings.set("general.autoImport", false);
        const injector = new DiagnosticInjector("verse-itest-t5");
        try {
            const document = await openFixture("t5_optimize.verse");
            injector.inject(document, [corpusMessage("unknown-with-suggestion-function-context")]);
            await sleep(300);

            const intermediateStates: string[] = [];
            const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.document.uri.toString() === document.uri.toString()) {
                    intermediateStates.push(event.document.getText());
                }
            });
            const text = await runOptimizeImports(document);
            subscription.dispose();

            // Atomicity proxy: the document must never pass through a state
            // with no imports at all (the pre-#42 remove-then-re-add shape).
            assert.ok(intermediateStates.length >= 1, "optimize should have edited the document");
            for (const state of intermediateStates) {
                assert.ok(/^using /m.test(state), `imports vanished in an intermediate state:\n${state}`);
            }

            const lines = text.split("\n");
            assert.strictEqual(countOccurrences(text, "using { /Verse.org/Simulation }"), 1, "duplicate import must be deduplicated");
            assert.strictEqual(countOccurrences(text, "using { /Fortnite.com/Devices }"), 1);
            assert.strictEqual(countOccurrences(text, "using { /Verse.org/Assets }"), 1, "the missing import from current diagnostics must be added");
            assert.strictEqual(countOccurrences(text, "/Fortnite.com/Playspaces"), 1, "the indented pair must be absorbed with its path intact");

            // All file-level imports end up above the first declaration.
            const firstCodeLine = lines.findIndex((line) => line.includes(":= class"));
            assert.ok(firstCodeLine !== -1, "fixture declarations disappeared");
            const fileLevelImports = ["using { /Verse.org/Simulation }", "using { /Fortnite.com/Devices }", "using { /Verse.org/Assets }", "using { /Fortnite.com/Playspaces }"];
            for (const statement of fileLevelImports) {
                const lineIndex = lines.findIndex((line) => line.trim() === statement);
                assert.ok(lineIndex !== -1 && lineIndex < firstCodeLine, `${statement} must sit in the top import block, got:\n${text}`);
            }

            // The local-scope using stays indented inside Describe().
            const localUsing = lines.findIndex((line) => line.includes("using { Helper }"));
            assert.ok(localUsing !== -1, "local-scope using must not be deleted");
            assert.ok(/^\s+using \{ Helper \}/.test(lines[localUsing]), "local-scope using must stay indented in the function body");
            const describeLine = lines.findIndex((line) => line.includes("Describe("));
            assert.ok(describeLine !== -1 && localUsing > describeLine, "local-scope using must stay inside the function");

            // No code between the scattered imports was deleted.
            assert.ok(text.includes("t5_helper := class"), "t5_helper class lost");
            assert.ok(text.includes("Helper.GetLabel()"), "function body lost");
        } finally {
            injector.dispose();
            await settings.restoreAll();
        }
    });
});
