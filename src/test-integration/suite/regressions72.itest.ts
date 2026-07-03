import * as assert from "assert";
import { DiagnosticInjector, WorkspaceSettings, assertNoDocumentChange, corpusMessage, countOccurrences, docText, openFixture, runOptimizeImports, sleep, waitForDocumentChange } from "./helpers";

describe("PR #72 regressions (issues #69/#70)", () => {
    let injector: DiagnosticInjector;

    beforeEach(() => {
        injector = new DiagnosticInjector("verse-itest-r72");
    });

    afterEach(() => {
        injector.dispose();
    });

    it("a 'set' assignment hint never triggers an insert", async () => {
        const document = await openFixture("r72_set_hint.verse");
        injector.inject(document, [corpusMessage("set-assignment-hint")], "Count");

        await assertNoDocumentChange(document);
    });

    it("bare identifier options never become imports; the remaining candidate is unambiguous", async () => {
        const document = await openFixture("r72_bare_identifier.verse");
        injector.inject(document, [corpusMessage("did-you-mean-any-of-bare-option")], "item");

        await waitForDocumentChange(document, (text) => text.includes("using { InventoryModule }"), "auto-import of InventoryModule");
        await sleep(500);

        const text = docText(document);
        assert.strictEqual(countOccurrences(text, "using { InventoryModule }"), 1);
        assert.ok(!/^using \{ item \}/m.test(text), "a bare identifier option must never be imported");
    });

    it("Optimize Imports does not bulk-add ambiguous candidates or 'set' hints", async () => {
        const settings = new WorkspaceSettings();
        await settings.set("general.autoImport", false);
        try {
            const document = await openFixture("r72_optimize_guard.verse");
            injector.inject(document, [corpusMessage("forget-one-of-two-paths"), corpusMessage("identifier-many-types"), corpusMessage("set-assignment-hint")], "thing");
            await sleep(300);

            const text = await runOptimizeImports(document);

            assert.strictEqual(countOccurrences(text, "using { /Verse.org/Simulation }"), 1, "the existing import must survive optimize");
            const forbidden = ["/GameA/Combat", "/GameB/Combat", "/Verse.org/SpatialMath", "/UnrealEngine.com/Temporary/SpatialMath", "to write 'set"];
            for (const fragment of forbidden) {
                assert.ok(!text.includes(fragment), `optimize must not add anything containing '${fragment}', got:\n${text}`);
            }
        } finally {
            await settings.restoreAll();
        }
    });
});
