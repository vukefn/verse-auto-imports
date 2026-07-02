import { ImportSuggestionExtractor } from "../ImportSuggestionExtractor";
import { ImportFormatter } from "../ImportFormatter";
import * as vscode from "vscode";

describe("ImportSuggestionExtractor", () => {
    let extractor: ImportSuggestionExtractor;
    let formatter: ImportFormatter;
    let outputChannel: vscode.OutputChannel;

    beforeEach(() => {
        outputChannel = vscode.window.createOutputChannel("test");
        formatter = new ImportFormatter();
        extractor = new ImportSuggestionExtractor(outputChannel, formatter);
    });

    describe("extractImportSuggestions", () => {
        it("should parse 'Did you forget to specify using { /Path }' into a high-confidence suggestion", async () => {
            const errorMessage = "This identifier is unknown. Did you forget to specify using { /Verse.org/Simulation }";

            const suggestions = await extractor.extractImportSuggestions(errorMessage);

            expect(suggestions).toHaveLength(1);
            expect(suggestions[0].importStatement).toBe("using { /Verse.org/Simulation }");
            expect(suggestions[0].source).toBe("error_message");
            expect(suggestions[0].confidence).toBe("high");
            expect(suggestions[0].modulePath).toBe("/Verse.org/Simulation");
        });
    });
});
