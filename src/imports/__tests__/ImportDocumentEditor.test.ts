import { ImportDocumentEditor } from "../ImportDocumentEditor";
import { ImportFormatter } from "../ImportFormatter";
import * as vscode from "vscode";

describe("ImportDocumentEditor.buildOrganizedContent", () => {
    let editor: ImportDocumentEditor;

    const curlyNoSort = {
        preferDotSyntax: false,
        sortAlphabetically: false,
        importGrouping: "none",
    };
    const curlySorted = { ...curlyNoSort, sortAlphabetically: true };

    beforeEach(() => {
        const outputChannel = vscode.window.createOutputChannel("test");
        editor = new ImportDocumentEditor(outputChannel, new ImportFormatter());
    });

    it("returns null when there are no imports and nothing to add", () => {
        expect(editor.buildOrganizedContent("foo := 1\nbar := 2", [], curlyNoSort)).toBeNull();
    });

    it("consolidates existing imports at the top with one blank line before code", () => {
        const input = "using { /A }\nusing { /B }\ncode()";
        expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe("using { /A }\nusing { /B }\n\ncode()");
    });

    it("deduplicates repeated imports", () => {
        const input = "using { /A }\nusing { /A }\ncode()";
        expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe("using { /A }\n\ncode()");
    });

    it("sorts alphabetically when enabled", () => {
        const input = "using { /Zebra }\nusing { /Apple }\ncode()";
        expect(editor.buildOrganizedContent(input, [], curlySorted)).toBe("using { /Apple }\nusing { /Zebra }\n\ncode()");
    });

    it("preserves original order when sorting is disabled", () => {
        const input = "using { /Zebra }\nusing { /Apple }\ncode()";
        expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe("using { /Zebra }\nusing { /Apple }\n\ncode()");
    });

    it("writes the preferred dot syntax", () => {
        const input = "using { /A }\ncode()";
        expect(
            editor.buildOrganizedContent(input, [], {
                ...curlyNoSort,
                preferDotSyntax: true,
            }),
        ).toBe("using. /A\n\ncode()");
    });

    it("normalizes the indented using: pair into a single-line import", () => {
        const input = "using:\n    /A\ncode()";
        expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe("using { /A }\n\ncode()");
    });

    it("hoists an import scattered below code up into the block", () => {
        const input = "code_before()\nusing { /A }\ncode_after()";
        expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe("using { /A }\n\ncode_before()\ncode_after()");
    });

    it("merges additional paths with existing imports, deduped and sorted", () => {
        const input = "using { /Existing }\ncode()";
        expect(editor.buildOrganizedContent(input, ["/Added", "/Existing"], curlySorted)).toBe("using { /Added }\nusing { /Existing }\n\ncode()");
    });

    it("adds imports to a document that had none", () => {
        expect(editor.buildOrganizedContent("code()", ["/New"], curlyNoSort)).toBe("using { /New }\n\ncode()");
    });

    it("leaves local-scope using statements in the body", () => {
        const input = "using { /A }\nusing { LocalVar }\ncode()";
        expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe("using { /A }\n\nusing { LocalVar }\ncode()");
    });

    it("collapses extra blank lines left by removed top imports", () => {
        const input = "using { /A }\n\n\ncode()";
        expect(editor.buildOrganizedContent(input, [], curlyNoSort)).toBe("using { /A }\n\ncode()");
    });

    it("returns only the import block when the file is nothing but imports", () => {
        const input = "using { /B }\nusing { /A }";
        expect(editor.buildOrganizedContent(input, [], curlySorted)).toBe("using { /A }\nusing { /B }\n");
    });

    it("ignores blank additional paths", () => {
        const input = "using { /A }\ncode()";
        expect(editor.buildOrganizedContent(input, ["", "   "], curlyNoSort)).toBe("using { /A }\n\ncode()");
    });

    it("leaves a module-scoped using inside its module body", () => {
        const input = ["using { /Top }", "", "Utilities := module:", "    using { /Verse.org/Random }", "", "    GenerateId<public>():int = 1"].join("\n");
        expect(editor.buildOrganizedContent(input, [], curlySorted)).toBe(
            ["using { /Top }", "", "Utilities := module:", "    using { /Verse.org/Random }", "", "    GenerateId<public>():int = 1"].join("\n"),
        );
    });
});

interface RecordedOperation {
    kind: "insert" | "delete" | "replace";
    position?: { line: number; character: number };
    range?: { start: { line: number; character: number }; end: { line: number; character: number } };
    text?: string;
}

function fakeDocument(text: string): vscode.TextDocument {
    const lines = text.split("\n");
    return {
        uri: { toString: () => "file:///test.verse" },
        getText: () => text,
        lineCount: lines.length,
        lineAt: (index: number) => ({ range: { end: new vscode.Position(index, lines[index].length) } }),
    } as unknown as vscode.TextDocument;
}

function appliedOperations(call: number): RecordedOperation[] {
    const applyEditMock = vscode.workspace.applyEdit as unknown as jest.Mock;
    const edit = applyEditMock.mock.calls[call][0] as { operations: RecordedOperation[] };
    return edit.operations;
}

describe("ImportDocumentEditor.addImportsToDocument", () => {
    let editor: ImportDocumentEditor;
    const applyEditMock = () => vscode.workspace.applyEdit as unknown as jest.Mock;

    beforeEach(() => {
        const outputChannel = vscode.window.createOutputChannel("test");
        editor = new ImportDocumentEditor(outputChannel, new ImportFormatter());
        applyEditMock().mockClear();
    });

    it("consolidates an indented-style pair without losing its path or orphaning its line", async () => {
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValueOnce({
            get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === "behavior.preserveImportLocations") {
                    return false;
                }
                return defaultValue;
            }),
            update: jest.fn().mockResolvedValue(undefined),
        });
        const input = ["using:", "    /Verse.org/Simulation", "", "hello := 1"].join("\n");

        const success = await editor.addImportsToDocument(fakeDocument(input), ["using { /Fortnite.com/Devices }"]);

        expect(success).toBe(true);
        const operations = appliedOperations(0);

        const insert = operations.find((op) => op.kind === "insert");
        expect(insert).toBeDefined();
        expect(insert!.text).toContain("/Verse.org/Simulation");
        expect(insert!.text).toContain("/Fortnite.com/Devices");

        const deletes = operations.filter((op) => op.kind === "delete");
        expect(deletes).toHaveLength(1);
        expect(deletes[0].range!.start.line).toBe(0);
        expect(deletes[0].range!.end.line).toBe(2);
    });

    it("recognizes an import that already exists as an indented pair and makes no edit", async () => {
        const input = ["using:", "    /Verse.org/Simulation", "", "hello := 1"].join("\n");

        const success = await editor.addImportsToDocument(fakeDocument(input), ["using { /Verse.org/Simulation }"]);

        expect(success).toBe(true);
        expect(applyEditMock()).not.toHaveBeenCalled();
    });

    it("leaves a module-scoped using inside its module body during consolidation", async () => {
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValueOnce({
            get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
                if (key === "behavior.preserveImportLocations") {
                    return false;
                }
                return defaultValue;
            }),
            update: jest.fn().mockResolvedValue(undefined),
        });
        const input = ["using { /Top }", "", "Utilities := module:", "    using { /Verse.org/Random }", "", "    GenerateId<public>():int = 1"].join("\n");

        const success = await editor.addImportsToDocument(fakeDocument(input), ["using { /Fortnite.com/Devices }"]);

        expect(success).toBe(true);
        const operations = appliedOperations(0);

        const insert = operations.find((op) => op.kind === "insert");
        expect(insert!.text).not.toContain("/Verse.org/Random");

        const deletes = operations.filter((op) => op.kind === "delete");
        expect(deletes).toHaveLength(1);
        expect(deletes[0].range!.start.line).toBe(0);
        expect(deletes[0].range!.end.line).toBe(1);
    });

    function mockConfig(overrides: Record<string, unknown>): void {
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValueOnce({
            get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
                if (key in overrides) {
                    return overrides[key];
                }
                return defaultValue;
            }),
            update: jest.fn().mockResolvedValue(undefined),
        });
    }

    it("preserve + digestFirst: replaces a single import block below a header in place, not at the top", async () => {
        mockConfig({
            "behavior.preserveImportLocations": true,
            "behavior.importGrouping": "digestFirst",
        });
        const header = ["# Header comment line 1", "# Header comment line 2", ""];
        const input = [...header, "using { /Verse.org/Simulation }", "using { /Fortnite.com/Devices }", "", "hello := 1"].join("\n");

        const success = await editor.addImportsToDocument(fakeDocument(input), ["using { /Fortnite.com/Random }"]);

        expect(success).toBe(true);
        const operations = appliedOperations(0);

        const replace = operations.find((op) => op.kind === "replace");
        expect(replace).toBeDefined();
        expect(replace!.range!.start.line).toBe(3);
        expect(replace!.text).toContain("/Fortnite.com/Random");
        expect(replace!.text).toContain("/Verse.org/Simulation");
        expect(replace!.text).toContain("/Fortnite.com/Devices");

        // Nothing is inserted above the header comment.
        const insertsAtTop = operations.filter((op) => op.kind === "insert" && op.position!.line === 0);
        expect(insertsAtTop).toHaveLength(0);
    });

    it("preserve + localFirst: replaces a single import block below a header in place, not at the top", async () => {
        mockConfig({
            "behavior.preserveImportLocations": true,
            "behavior.importGrouping": "localFirst",
        });
        const header = ["# Header comment line 1", "# Header comment line 2", ""];
        const input = [...header, "using { /Verse.org/Simulation }", "using { /Fortnite.com/Devices }", "", "hello := 1"].join("\n");

        const success = await editor.addImportsToDocument(fakeDocument(input), ["using { /Fortnite.com/Random }"]);

        expect(success).toBe(true);
        const operations = appliedOperations(0);

        const replace = operations.find((op) => op.kind === "replace");
        expect(replace).toBeDefined();
        expect(replace!.range!.start.line).toBe(3);
        expect(replace!.text).toContain("/Fortnite.com/Random");
        expect(replace!.text).toContain("/Verse.org/Simulation");

        const insertsAtTop = operations.filter((op) => op.kind === "insert" && op.position!.line === 0);
        expect(insertsAtTop).toHaveLength(0);
    });

    it("preserve + digestFirst: inserts at the top when the file has no existing imports", async () => {
        mockConfig({
            "behavior.preserveImportLocations": true,
            "behavior.importGrouping": "digestFirst",
        });
        const input = ["hello := 1", "world := 2"].join("\n");

        const success = await editor.addImportsToDocument(fakeDocument(input), ["using { /Fortnite.com/Random }"]);

        expect(success).toBe(true);
        const operations = appliedOperations(0);

        const insert = operations.find((op) => op.kind === "insert");
        expect(insert).toBeDefined();
        expect(insert!.position!.line).toBe(0);
        expect(insert!.text).toContain("/Fortnite.com/Random");

        expect(operations.some((op) => op.kind === "replace")).toBe(false);
        expect(operations.some((op) => op.kind === "delete")).toBe(false);
    });
});

describe("ImportDocumentEditor.ensureEmptyLinesAfterImports", () => {
    let editor: ImportDocumentEditor;
    const applyEditMock = () => vscode.workspace.applyEdit as unknown as jest.Mock;

    beforeEach(() => {
        const outputChannel = vscode.window.createOutputChannel("test");
        editor = new ImportDocumentEditor(outputChannel, new ImportFormatter());
        applyEditMock().mockClear();
    });

    it("does not enforce spacing after a module-scoped using", async () => {
        const input = ["using { /Top }", "", "M := module:", "    using { /Verse.org/Random }", "    F():void = {}", ""].join("\n");

        const success = await editor.ensureEmptyLinesAfterImports(fakeDocument(input));

        expect(success).toBe(true);
        expect(applyEditMock()).not.toHaveBeenCalled();
    });

    it("still enforces spacing after the file-level import block", async () => {
        const input = ["using { /Top }", "code()"].join("\n");

        const success = await editor.ensureEmptyLinesAfterImports(fakeDocument(input));

        expect(success).toBe(true);
        const operations = appliedOperations(0);
        expect(operations).toHaveLength(1);
        expect(operations[0].kind).toBe("insert");
        expect(operations[0].position!.line).toBe(1);
    });
});
