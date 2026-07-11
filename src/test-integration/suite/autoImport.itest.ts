import * as assert from "assert";
import * as vscode from "vscode";
import { DiagnosticInjector, assertNoDocumentChange, corpusMessage, countOccurrences, docText, openFixture, sleep, waitForDocumentChange } from "./helpers";

describe("auto-import pipeline (playbook T1/T2/T3)", () => {
    let injector: DiagnosticInjector;

    beforeEach(() => {
        injector = new DiagnosticInjector("verse-itest-auto");
    });

    afterEach(() => {
        injector.dispose();
    });

    it("T1: a single corpus suggestion auto-imports exactly once", async () => {
        const document = await openFixture("t1_single_suggestion.verse");
        injector.inject(document, [corpusMessage("unknown-with-suggestion-class-context")], "button_device");

        await waitForDocumentChange(document, (text) => text.includes("using { /Fortnite.com/Devices }"), "auto-import of /Fortnite.com/Devices");
        await sleep(500);

        assert.strictEqual(countOccurrences(docText(document), "using { /Fortnite.com/Devices }"), 1, "import must be inserted exactly once");
    });

    it("T1: several single-suggestion diagnostics in one debounce window import once each", async () => {
        const document = await openFixture("t1_multiple_singles.verse");
        injector.inject(document, [
            corpusMessage("unknown-with-suggestion-class-context"),
            corpusMessage("unknown-with-suggestion-module-context"),
            corpusMessage("unknown-with-suggestion-function-context"),
        ]);

        const statements = ["using { /Fortnite.com/Devices }", "using { /Verse.org/Simulation }", "using { /Verse.org/Assets }"];
        await waitForDocumentChange(document, (text) => statements.every((statement) => text.includes(statement)), "auto-import of all three suggestions");
        await sleep(500);

        const text = docText(document);
        for (const statement of statements) {
            assert.strictEqual(countOccurrences(text, statement), 1, `expected exactly one '${statement}'`);
        }
    });

    it("T3: an asset suggestion imports the containing folder, never the asset itself", async () => {
        const document = await openFixture("t3_asset_reference.verse");
        injector.inject(document, [corpusMessage("did-you-mean-single-asset")], "image2");

        await waitForDocumentChange(document, (text) => text.includes("using { Folder1 }"), "auto-import of Folder1");
        await sleep(500);

        const text = docText(document);
        assert.strictEqual(countOccurrences(text, "using { Folder1 }"), 1);
        assert.ok(!text.includes("using { Folder1.image2 }"), "the import must not embed the asset name");
    });

    it("T2: multi-option diagnostics do not auto-import under the default quickfix strategy", async () => {
        const document = await openFixture("t2_multi_option.verse");
        injector.inject(document, [corpusMessage("forget-one-of-two-paths")], "thing");

        await assertNoDocumentChange(document);
    });

    it("T2: quick fixes offer every candidate of a multi-option diagnostic", async () => {
        const document = await openFixture("t2_multi_option.verse");
        injector.inject(document, [corpusMessage("did-you-mean-any-of-qualified-options")], "combat_probe");
        await sleep(300);

        const anchor = document.getText().indexOf("combat_probe");
        assert.ok(anchor !== -1, "fixture is missing the combat_probe anchor");
        const range = new vscode.Range(document.positionAt(anchor), document.positionAt(anchor + "combat_probe".length));

        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", document.uri, range);
        const titles = (actions ?? []).map((action) => action.title);
        assert.ok(
            titles.some((title) => title.includes("using { Systems }")),
            `missing 'using { Systems }' quick fix, got: ${titles.join(" | ")}`,
        );
        assert.ok(
            titles.some((title) => title.includes("using { Features }")),
            `missing 'using { Features }' quick fix, got: ${titles.join(" | ")}`,
        );
    });
});
