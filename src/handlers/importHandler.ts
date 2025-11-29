import * as vscode from "vscode";
import { ImportSuggestion } from "../types/moduleInfo";
import { ImportFormatter } from "./importFormatter";
import { ImportSuggestionExtractor } from "./importSuggestionExtractor";
import { ImportDocumentEditor } from "./importDocumentEditor";

/**
 * Facade class that coordinates import handling operations.
 * Maintains backward compatibility while delegating to specialized classes.
 */
export class ImportHandler {
    private formatter: ImportFormatter;
    private suggestionExtractor: ImportSuggestionExtractor;
    private documentEditor: ImportDocumentEditor;

    constructor(private outputChannel: vscode.OutputChannel) {
        this.formatter = new ImportFormatter();
        this.suggestionExtractor = new ImportSuggestionExtractor(outputChannel, this.formatter);
        this.documentEditor = new ImportDocumentEditor(outputChannel, this.formatter);
    }

    /**
     * Extracts existing import statements from a document.
     */
    extractExistingImports(document: vscode.TextDocument): string[] {
        return this.documentEditor.extractExistingImports(document);
    }

    /**
     * Extracts import suggestions from an error message.
     */
    async extractImportSuggestions(errorMessage: string): Promise<ImportSuggestion[]> {
        return this.suggestionExtractor.extractImportSuggestions(errorMessage);
    }

    /**
     * Legacy method for backward compatibility.
     * @deprecated Use extractImportSuggestions instead
     */
    async extractImportStatement(errorMessage: string): Promise<string | null> {
        return this.suggestionExtractor.extractImportStatement(errorMessage);
    }

    /**
     * Adds import statements to a document.
     */
    async addImportsToDocument(document: vscode.TextDocument, importStatements: string[]): Promise<boolean> {
        return this.documentEditor.addImportsToDocument(document, importStatements);
    }

    /**
     * Removes all import statements from the document.
     */
    async removeAllImports(document: vscode.TextDocument): Promise<boolean> {
        return this.documentEditor.removeAllImports(document);
    }

    /**
     * Extracts import suggestions from VS Code diagnostics.
     */
    extractImportsFromDiagnostics(diagnostics: vscode.Diagnostic[]): string[] {
        return this.suggestionExtractor.extractImportsFromDiagnostics(diagnostics);
    }

    /**
     * Ensures the proper number of empty lines exists after the last import statement.
     */
    async ensureEmptyLinesAfterImports(document: vscode.TextDocument): Promise<boolean> {
        return this.documentEditor.ensureEmptyLinesAfterImports(document);
    }

    /**
     * Converts all import statements in the document to the preferred syntax.
     */
    async convertScatteredImportsToPreferredSyntax(document: vscode.TextDocument): Promise<boolean> {
        return this.documentEditor.convertScatteredImportsToPreferredSyntax(document);
    }
}
