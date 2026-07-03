import * as assert from "assert";
import * as vscode from "vscode";
import { DiagnosticInjector, WorkspaceSettings, corpusMessage, countOccurrences, openFixture, runOptimizeImports, sleep, waitForDocumentChange } from "./helpers";

function assertNoOrphanedUsingLine(text: string): void {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
        if (line.trim() === "using:") {
            const next = lines[index + 1] ?? "";
            assert.ok(/^\s+\S/.test(next), `orphaned 'using:' at line ${index}; next line is '${next}'`);
        }
    });
}

function assertModuleScopedUsingInPlace(text: string, moduleName: string): void {
    assert.strictEqual(countOccurrences(text, "using { /Verse.org/Random }"), 1, "the module-scoped using must appear exactly once");
    const lines = text.split("\n");
    const moduleLine = lines.findIndex((line) => line.includes(`${moduleName} := module:`));
    const usingLine = lines.findIndex((line) => line.includes("using { /Verse.org/Random }"));
    assert.ok(moduleLine !== -1, "module declaration disappeared");
    assert.ok(usingLine > moduleLine, "the module-scoped using must stay below the module declaration, not hoisted to the top");
    assert.ok(/^\s+using/.test(lines[usingLine]), "the module-scoped using must stay indented inside the module body");
}

describe("PR #73 regressions (issues #67/#68)", () => {
    let injector: DiagnosticInjector;

    beforeEach(() => {
        injector = new DiagnosticInjector("verse-itest-r73");
    });

    afterEach(() => {
        injector.dispose();
    });

    it("an indented using: pair survives auto-import with its path intact", async () => {
        const document = await openFixture("r73_indented_using.verse");
        injector.inject(document, [corpusMessage("unknown-with-suggestion-class-context")], "button_device");

        await waitForDocumentChange(document, (text) => text.includes("using { /Fortnite.com/Devices }"), "auto-import of /Fortnite.com/Devices");
        await sleep(500);

        const text = document.getText();
        assert.strictEqual(countOccurrences(text, "/Fortnite.com/Playspaces"), 1, "the indented import's path must survive exactly once");
        assertNoOrphanedUsingLine(text);
    });

    it("auto-import leaves a module-scoped using in place", async () => {
        const document = await openFixture("r73_module_body_auto.verse");
        injector.inject(document, [corpusMessage("unknown-with-suggestion-class-context")], "button_device");

        await waitForDocumentChange(document, (text) => text.includes("using { /Fortnite.com/Devices }"), "auto-import of /Fortnite.com/Devices");
        await sleep(500);

        assertModuleScopedUsingInPlace(document.getText(), "r73_utilities_auto");
    });

    it("Optimize Imports leaves a module-scoped using in place", async () => {
        const settings = new WorkspaceSettings();
        await settings.set("general.autoImport", false);
        try {
            const document = await openFixture("r73_module_body_optimize.verse");
            const text = await runOptimizeImports(document);

            assertModuleScopedUsingInPlace(text, "r73_utilities_optimize");
            assert.strictEqual(countOccurrences(text, "using { /Verse.org/Simulation }"), 1);
            assert.strictEqual(countOccurrences(text, "using { /Fortnite.com/Devices }"), 1);
        } finally {
            await settings.restoreAll();
        }
    });

    it("on-save spacing is not applied inside a module body", async () => {
        const document = await openFixture("r67_module_body_save.verse");

        // Dirty the document with an edit far away from any import, then save
        // to run the on-save spacing pass.
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(document.lineCount, 0), "\n# save probe\n");
        assert.ok(await vscode.workspace.applyEdit(edit), "probe edit failed");
        assert.ok(await document.save(), "save failed");
        await sleep(500);

        const text = document.getText();
        assert.ok(text.includes("using { /Verse.org/Random }\n    GenerateId"), `no blank line may be inserted after the module-scoped using, got:\n${text}`);
    });
});
