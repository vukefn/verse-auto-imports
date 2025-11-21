import * as vscode from "vscode";
import { log } from "../utils/logging";
import { ImportSuggestion, ImportSuggestionSource, ImportConfidence } from "../types/moduleInfo";
import { DigestParser, DigestEntry } from "../utils/digestParser";

export class ImportHandler {
    private digestParser: DigestParser;

    constructor(private outputChannel: vscode.OutputChannel) {
        this.digestParser = new DigestParser(outputChannel);
    }

    private parseMultiOptionSuggestions(errorMessage: string): string[] {
        // Pattern 1: "Did you mean any of:\n<options>"
        const multiOptionPattern1 = /Did you mean any of:\s*\n(.+)/s;
        const match1 = errorMessage.match(multiOptionPattern1);

        if (match1) {
            const optionsText = match1[1];
            const options = optionsText
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            log(this.outputChannel, `Found ${options.length} multi-options (pattern 1): ${options.join(', ')}`);
            return options;
        }

        // Pattern 2: "Did you forget to specify one of:\nusing { /Path }\nusing { /Path }"
        const multiOptionPattern2 = /Did you forget to specify one of:\s*\n((?:using \{[^}]+\}\s*\n?)+)/s;
        const match2 = errorMessage.match(multiOptionPattern2);

        if (match2) {
            const optionsText = match2[1];
            const options: string[] = [];

            // Extract all "using { /Path }" patterns
            const usingPattern = /using \{ (\/[^}]+) \}/g;
            let usingMatch;
            while ((usingMatch = usingPattern.exec(optionsText)) !== null) {
                options.push(usingMatch[1]);
            }

            log(this.outputChannel, `Found ${options.length} multi-options (pattern 2): ${options.join(', ')}`);
            return options;
        }

        // Pattern 3: "Identifier X could be one of many types: (/Path1:)X or (/Path2:)X"
        const multiOptionPattern3 = /Identifier \w+ could be one of many types:\s*(.+)/;
        const match3 = errorMessage.match(multiOptionPattern3);

        if (match3) {
            const optionsText = match3[1];
            const options: string[] = [];

            // Extract all "(/Path:)" patterns
            const pathPattern = /\((\/[^:)]+):\)/g;
            let pathMatch;
            while ((pathMatch = pathPattern.exec(optionsText)) !== null) {
                options.push(pathMatch[1]);
            }

            log(this.outputChannel, `Found ${options.length} multi-options (pattern 3): ${options.join(', ')}`);
            return options;
        }

        return [];
    }

    private selectBestOption(options: string[]): string {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const strategy = config.get<string>("behavior.multiOptionStrategy", "auto_shortest");

        switch (strategy) {
            case "auto_shortest":
                // Return the option with the shortest path
                return options.reduce((shortest, current) =>
                    current.length < shortest.length ? current : shortest
                );
            case "auto_first":
                return options[0];
            default:
                return options[0]; // fallback
        }
    }

    private createImportSuggestion(
        importStatement: string,
        source: ImportSuggestionSource,
        confidence: ImportConfidence,
        description?: string
    ): ImportSuggestion {
        const modulePath = this.extractPathFromImport(importStatement);
        return {
            importStatement,
            source,
            confidence,
            description,
            modulePath: modulePath || undefined
        };
    }

    private async lookupIdentifierInDigest(identifier: string): Promise<ImportSuggestion[]> {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const useDigestFiles = config.get<boolean>("experimental.useDigestFiles", false);
        const preferDotSyntax = config.get<string>("behavior.importSyntax", "curly") === "dot";

        if (!useDigestFiles) {
            return [];
        }

        try {
            const digestEntries = await this.digestParser.lookupIdentifier(identifier);
            const suggestions: ImportSuggestion[] = [];

            for (const entry of digestEntries) {
                if (!entry.modulePath) {
                    continue;
                }

                const importStatement = this.formatImportStatement(entry.modulePath, preferDotSyntax);
                const confidence: ImportConfidence = entry.identifier === identifier ? 'high' : 'medium';
                const description = `${entry.type} from ${entry.modulePath}`;

                suggestions.push(this.createImportSuggestion(
                    importStatement,
                    'digest_lookup',
                    confidence,
                    description
                ));
            }

            if (suggestions.length > 0) {
                log(this.outputChannel, `Found ${suggestions.length} digest-based suggestions for: ${identifier}`);
            }

            return suggestions;
        } catch (error) {
            log(this.outputChannel, `Error looking up identifier in digest: ${error}`);
            return [];
        }
    }

    extractExistingImports(document: vscode.TextDocument): string[] {
        log(this.outputChannel, "Extracting existing imports from document");
        const text = document.getText();
        const lines = text.split("\n");
        const imports = new Set<string>();

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("using")) {
                log(this.outputChannel, `Found import: ${trimmed}`);
                imports.add(trimmed);
            }
        }

        log(this.outputChannel, `Extracted ${imports.size} existing imports`);
        return Array.from(imports);
    }

    async extractImportSuggestions(errorMessage: string): Promise<ImportSuggestion[]> {
        log(this.outputChannel, `Extracting import suggestions from error: ${errorMessage}`);

        // Ignore errors that suggest using 'set' instead of import issues
        if (errorMessage.includes("Did you mean to write 'set")) {
            log(this.outputChannel, `Ignoring 'set' suggestion error`);
            return [];
        }

        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const preferDotSyntax = config.get<string>("behavior.importSyntax", "curly") === "dot";
        const ambiguousImportMappings = config.get<Record<string, string>>("ambiguousImports", {});

        // Check for multi-option "Did you mean any of" pattern first
        const multiOptions = this.parseMultiOptionSuggestions(errorMessage);
        if (multiOptions.length > 0) {
            log(this.outputChannel, `Found multi-option pattern with ${multiOptions.length} options`);
            const suggestions: ImportSuggestion[] = [];

            for (const option of multiOptions) {
                // Check if option is a module path (starts with /)
                if (option.startsWith('/')) {
                    // Direct module path from "using { /Path }" format
                    const importStatement = this.formatImportStatement(option, preferDotSyntax);
                    const moduleName = option.split('/').pop() || option;

                    log(this.outputChannel, `Multi-option (module path): ${option}`);

                    suggestions.push(this.createImportSuggestion(
                        importStatement,
                        'error_message',
                        'high',
                        `Import from ${option}`
                    ));
                } else {
                    // Fully qualified class name (e.g., "Module.ClassName")
                    const lastDotIndex = option.lastIndexOf(".");
                    if (lastDotIndex > 0) {
                        const namespace = option.substring(0, lastDotIndex);
                        const className = option.substring(lastDotIndex + 1);
                        const importStatement = this.formatImportStatement(namespace, preferDotSyntax);

                        log(this.outputChannel, `Multi-option: ${option} -> namespace: ${namespace}, class: ${className}`);

                        suggestions.push(this.createImportSuggestion(
                            importStatement,
                            'error_message',
                            'high',
                            `${className} from ${namespace}`
                        ));
                    } else {
                        // No namespace detected, treat as simple reference
                        const importStatement = this.formatImportStatement(option, preferDotSyntax);
                        log(this.outputChannel, `Multi-option (no namespace): ${option}`);

                        suggestions.push(this.createImportSuggestion(
                            importStatement,
                            'error_message',
                            'medium',
                            `Import ${option}`
                        ));
                    }
                }
            }

            return suggestions;
        }

        // Check for unknown identifier with ambiguous mapping or digest lookup
        const classNameMatch = errorMessage.match(/Unknown identifier `([^`]+)`/);
        if (classNameMatch) {
            const className = classNameMatch[1];

            // Check if this unknown identifier error also includes a specific import suggestion
            // Pattern: "Unknown identifier `editable`. Did you forget to specify using { /Verse.org/Simulation }"
            const specificSuggestionMatch = errorMessage.match(/Unknown identifier `[^`]+`.*Did you forget to specify using \{ (\/[^}]+) \}/s);
            if (specificSuggestionMatch) {
                const path = specificSuggestionMatch[1];
                const importStatement = this.formatImportStatement(path, preferDotSyntax);
                log(this.outputChannel, `Found specific import suggestion for unknown identifier ${className}: ${importStatement}`);
                return [this.createImportSuggestion(
                    importStatement,
                    'error_message',
                    'high',
                    `Import ${className} from ${path}`
                )];
            }

            // First check configured ambiguous mappings
            if (ambiguousImportMappings[className]) {
                const preferredPath = ambiguousImportMappings[className];
                const importStatement = this.formatImportStatement(preferredPath, preferDotSyntax);

                log(this.outputChannel, `Using configured path for ambiguous class ${className}: ${importStatement}`);
                return [this.createImportSuggestion(
                    importStatement,
                    'error_message',
                    'high',
                    `Configured import for ${className}`
                )];
            }

            // Try digest-based lookup for unknown identifier
            const digestSuggestions = await this.lookupIdentifierInDigest(className);
            if (digestSuggestions.length > 0) {
                log(this.outputChannel, `Found digest-based suggestions for unknown identifier: ${className}`);
                return digestSuggestions;
            }
        }

        // Pattern 1: "Did you forget to specify using { /Path }"
        let match = errorMessage.match(/Did you forget to specify (using \{ \/[^}]+ \})/);
        if (match) {
            const path = match[1].match(/using \{ (\/[^}]+) \}/)?.[1];
            if (path) {
                const importStatement = this.formatImportStatement(path, preferDotSyntax);
                log(this.outputChannel, `Found import statement: ${importStatement}`);
                return [this.createImportSuggestion(
                    importStatement,
                    'error_message',
                    'high',
                    `Standard import for ${path}`
                )];
            }
        }

        // Pattern 2: "Did you mean Namespace.Component" (single option)
        match = errorMessage.match(/Did you mean ([^`\n]+)/);
        if (match) {
            const fullName = match[1].trim();
            const lastDotIndex = fullName.lastIndexOf(".");
            log(this.outputChannel, `Last dot index: ${lastDotIndex} for ${fullName}`);
            if (lastDotIndex > 0) {
                const namespace = fullName.substring(0, lastDotIndex);
                const importStatement = this.formatImportStatement(namespace, preferDotSyntax);
                log(this.outputChannel, `Inferred import statement: ${importStatement}`);
                return [this.createImportSuggestion(
                    importStatement,
                    'error_message',
                    'high',
                    `Inferred import for ${fullName}`
                )];
            }
        }

        log(this.outputChannel, "No import suggestions found in error message");
        return [];
    }

    // Keep the old method for backward compatibility temporarily
    async extractImportStatement(errorMessage: string): Promise<string | null> {
        const suggestions = await this.extractImportSuggestions(errorMessage);
        if (suggestions.length > 0) {
            // For backward compatibility, return the first suggestion's import statement
            return suggestions[0].importStatement;
        }
        return null;
    }

    async addImportsToDocument(document: vscode.TextDocument, importStatements: string[]): Promise<boolean> {
        log(this.outputChannel, `Adding ${importStatements.length} import statements to document`);

        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const preferDotSyntax = config.get<string>("behavior.importSyntax", "curly") === "dot";
        const preserveImportLocations = config.get<boolean>("behavior.preserveImportLocations", false);
        const sortAlphabetically = config.get<boolean>("behavior.sortImportsAlphabetically", true);
        const importGrouping = config.get<string>("behavior.importGrouping", "none");

        log(
            this.outputChannel,
            `Import statements received:${preserveImportLocations ? " (locations will be preserved)" : ""} Sort: ${sortAlphabetically} Grouping: ${importGrouping}`
        );
        importStatements.forEach((statement) => {
            log(this.outputChannel, `- ${statement}`);
        });

        const text = document.getText();
        const lines = text.split("\n");
        const existingImports = new Set<string>();

        const importBlocks: { start: number; end: number; imports: string[] }[] = [];
        let currentBlock: { start: number; end: number; imports: string[] } | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("using")) {
                log(this.outputChannel, `Found existing import at line ${i}: ${line}`);

                existingImports.add(line);

                if (!currentBlock) {
                    currentBlock = { start: i, end: i, imports: [line] };
                } else if (i === currentBlock.end + 1 || (i === currentBlock.end + 2 && lines[i - 1].trim() === "")) {
                    currentBlock.end = i;
                    currentBlock.imports.push(line);
                } else {
                    importBlocks.push(currentBlock);
                    currentBlock = { start: i, end: i, imports: [line] };
                }
            }
        }

        if (currentBlock) {
            importBlocks.push(currentBlock);
        }

        log(this.outputChannel, `Found ${existingImports.size} existing imports in ${importBlocks.length} blocks`);

        const existingPaths = new Set<string>();
        existingImports.forEach((imp) => {
            const path = this.extractPathFromImport(imp);
            if (path) {
                existingPaths.add(path);
            }
        });

        const newImportPaths = new Set<string>();
        importStatements.forEach((imp) => {
            const path = this.extractPathFromImport(imp);
            if (path && !existingPaths.has(path)) {
                log(this.outputChannel, `New import needed: ${path}`);
                newImportPaths.add(path);
            }
        });

        if (newImportPaths.size === 0) {
            log(this.outputChannel, "No new imports needed, skipping update");
            return true;
        }

        const edit = new vscode.WorkspaceEdit();

        if (preserveImportLocations) {
            const newImports = Array.from(newImportPaths).map((path) =>
                this.formatImportStatement(path, preferDotSyntax)
            );

            if (sortAlphabetically) {
                newImports.sort();
            }

            if (importBlocks.length > 0 && importBlocks[0].start === 0) {
                edit.insert(
                    document.uri,
                    new vscode.Position(importBlocks[0].end + 1, 0),
                    newImports.join("\n") + "\n"
                );
            } else {
                edit.insert(document.uri, new vscode.Position(0, 0), newImports.join("\n") + "\n\n");
            }
        } else {
            // Consolidate all imports at the top
            const allPaths = new Set<string>([...existingPaths, ...newImportPaths]);
            const allImportsArray = Array.from(allPaths);

            let formattedImports: string[] = [];

            if (importGrouping === "none") {
                // Legacy behavior: simple alphabetical sort if enabled
                if (sortAlphabetically) {
                    allImportsArray.sort((a, b) => a.localeCompare(b));
                }
                formattedImports = allImportsArray
                    .map((path) => this.formatImportStatement(path, preferDotSyntax));
            } else {
                // New grouping behavior: separate digest and local imports
                const digestImports: string[] = [];
                const localImports: string[] = [];

                for (const path of allImportsArray) {
                    if (this.isDigestImport(path)) {
                        digestImports.push(path);
                    } else {
                        localImports.push(path);
                    }
                }

                // Sort within groups if enabled
                if (sortAlphabetically) {
                    digestImports.sort((a, b) => a.localeCompare(b));
                    localImports.sort((a, b) => a.localeCompare(b));
                }

                // Format the imports
                const formattedDigestImports = digestImports
                    .map((path) => this.formatImportStatement(path, preferDotSyntax));
                const formattedLocalImports = localImports
                    .map((path) => this.formatImportStatement(path, preferDotSyntax));

                // Combine based on configuration
                if (importGrouping === "digestFirst") {
                    formattedImports = [...formattedDigestImports];
                    // Add spacing between groups if both have imports
                    if (formattedDigestImports.length > 0 && formattedLocalImports.length > 0) {
                        formattedImports.push(""); // Empty line between groups
                    }
                    formattedImports.push(...formattedLocalImports);
                } else if (importGrouping === "localFirst") {
                    formattedImports = [...formattedLocalImports];
                    // Add spacing between groups if both have imports
                    if (formattedLocalImports.length > 0 && formattedDigestImports.length > 0) {
                        formattedImports.push(""); // Empty line between groups
                    }
                    formattedImports.push(...formattedDigestImports);
                }
            }

            // Determine the line after all existing import blocks to check for spacing
            let lineAfterImports = 0;
            if (importBlocks.length > 0) {
                lineAfterImports = Math.max(...importBlocks.map(block => block.end)) + 1;
            }

            // Check if there's already an empty line after imports
            let needsEmptyLine = true;
            if (lineAfterImports < lines.length) {
                const lineAfter = lines[lineAfterImports];
                // If the line after imports is empty, we don't need to add another empty line
                if (lineAfter && lineAfter.trim() === "") {
                    needsEmptyLine = false;
                } else if (lineAfterImports === lines.length - 1 || !lineAfter) {
                    // If we're at the end of file or no content after, we still want the empty line
                    needsEmptyLine = true;
                }
            }

            // Insert imports at top with appropriate spacing
            const importsText = formattedImports.join("\n") + "\n" + (needsEmptyLine ? "\n" : "");
            edit.insert(document.uri, new vscode.Position(0, 0), importsText);

            // Remove existing import blocks (in reverse order to maintain line numbers)
            for (let i = importBlocks.length - 1; i >= 0; i--) {
                const block = importBlocks[i];
                edit.delete(
                    document.uri,
                    new vscode.Range(new vscode.Position(block.start, 0), new vscode.Position(block.end + 1, 0))
                );
            }
        }

        try {
            const success = await vscode.workspace.applyEdit(edit);
            log(
                this.outputChannel,
                success ? "Successfully updated imports in document" : "Failed to update imports in document"
            );
            return success;
        } catch (error) {
            log(this.outputChannel, `Error updating imports: ${error}`);
            return false;
        }
    }

    private formatImportStatement(path: string, useDotSyntax: boolean): string {
        return useDotSyntax ? `using. ${path.trim()}` : `using { ${path.trim()} }`;
    }

    private extractPathFromImport(importStatement: string): string | null {
        const curlyMatch = importStatement.match(/using\s*\{\s*([^}]+)\s*\}/);
        if (curlyMatch) {
            return curlyMatch[1].trim();
        }

        const dotMatch = importStatement.match(/using\.\s*(.+)/);
        if (dotMatch) {
            return dotMatch[1].trim();
        }

        return null;
    }

    /**
     * Determines if an import is a digest import (from Verse.org, Fortnite.com, or UnrealEngine.com)
     * @param importPath The import path or statement to check
     * @returns true if the import is from a digest source, false otherwise
     */
    private isDigestImport(importPath: string): boolean {
        // Extract the path if this is a full import statement
        let path = importPath;
        if (importPath.includes('using')) {
            path = this.extractPathFromImport(importPath) || importPath;
        }

        // Check if it's a digest import
        return path.startsWith('/Verse.org/') ||
               path.startsWith('/Fortnite.com/') ||
               path.startsWith('/UnrealEngine.com/');
    }

    /**
     * Removes all import statements from the document.
     * Handles all three Verse import formats:
     * - using { /path }
     * - using. /path
     * - using:
     *     /path
     */
    async removeAllImports(document: vscode.TextDocument): Promise<boolean> {
        log(this.outputChannel, "Removing all imports from document");

        const text = document.getText();
        const lines = text.split("\n");
        const resultLines: string[] = [];
        let i = 0;
        let removedCount = 0;

        while (i < lines.length) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Check for single-line imports (curly or dot syntax)
            if (trimmedLine.match(/^using\s*\{[^}]+\}/) || trimmedLine.match(/^using\.\s+.+/)) {
                log(this.outputChannel, `Removing single-line import at line ${i + 1}: ${trimmedLine}`);
                removedCount++;
                i++;
                continue;
            }

            // Check for multi-line import start
            if (trimmedLine.match(/^using\s*:\s*$/)) {
                log(this.outputChannel, `Found multi-line import start at line ${i + 1}`);
                removedCount++;
                i++;

                // Skip the next indented path line
                if (i < lines.length) {
                    const nextLine = lines[i];
                    // Check if next line is indented (has leading whitespace)
                    if (nextLine.match(/^\s+.+/)) {
                        log(this.outputChannel, `Removing indented path at line ${i + 1}: ${nextLine.trim()}`);
                        i++;
                    }
                }
                continue;
            }

            // Keep non-import lines
            resultLines.push(line);
            i++;
        }

        if (removedCount === 0) {
            log(this.outputChannel, "No imports found to remove");
            return true;
        }

        // Apply the edit to replace entire document
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            new vscode.Position(0, 0),
            document.lineAt(document.lineCount - 1).range.end
        );

        edit.replace(document.uri, fullRange, resultLines.join("\n"));

        try {
            const success = await vscode.workspace.applyEdit(edit);
            log(this.outputChannel, `Removed ${removedCount} import statements. Success: ${success}`);
            return success;
        } catch (error) {
            log(this.outputChannel, `Error removing imports: ${error}`);
            return false;
        }
    }

    /**
     * Extracts import suggestions from VS Code diagnostics.
     * Parses error messages to find missing imports.
     */
    extractImportsFromDiagnostics(diagnostics: vscode.Diagnostic[]): string[] {
        log(this.outputChannel, `Extracting imports from ${diagnostics.length} diagnostics`);

        const suggestedPaths = new Set<string>();

        for (const diagnostic of diagnostics) {
            const errorMessage = diagnostic.message;

            // Skip non-import related errors
            if (!errorMessage.includes("using") && !errorMessage.includes("Unknown identifier") &&
                !errorMessage.includes("Did you forget") && !errorMessage.includes("Did you mean")) {
                continue;
            }

            // Pattern 0: "Unknown identifier `x`. Did you forget to specify using { /Path }" (combined pattern)
            const unknownWithSuggestionMatch = errorMessage.match(/Unknown identifier `[^`]+`.*Did you forget to specify using \{ (\/[^}]+) \}/s);
            if (unknownWithSuggestionMatch) {
                suggestedPaths.add(unknownWithSuggestionMatch[1]);
                log(this.outputChannel, `Found path from unknown identifier with suggestion: ${unknownWithSuggestionMatch[1]}`);
                continue;
            }

            // Pattern 1: "Did you forget to specify using { /Path }"
            const forgetMatch = errorMessage.match(/Did you forget to specify using \{ (\/[^}]+) \}/);
            if (forgetMatch) {
                suggestedPaths.add(forgetMatch[1]);
                log(this.outputChannel, `Found path from 'forget' pattern: ${forgetMatch[1]}`);
                continue;
            }

            // Pattern 2: Multiple options "Did you forget to specify one of:"
            const multiMatch = errorMessage.match(/Did you forget to specify one of:\s*\n((?:using \{[^}]+\}\s*\n?)+)/s);
            if (multiMatch) {
                const optionsText = multiMatch[1];
                const usingPattern = /using \{ (\/[^}]+) \}/g;
                let usingMatch;
                while ((usingMatch = usingPattern.exec(optionsText)) !== null) {
                    suggestedPaths.add(usingMatch[1]);
                    log(this.outputChannel, `Found path from multi-option: ${usingMatch[1]}`);
                }
                continue;
            }

            // Pattern 3: "Identifier X could be one of many types: (/Path1:)X or (/Path2:)X"
            const identifierMatch = errorMessage.match(/Identifier \w+ could be one of many types:\s*(.+)/);
            if (identifierMatch) {
                const optionsText = identifierMatch[1];
                const pathPattern = /\((\/[^:)]+):\)/g;
                let pathMatch;
                while ((pathMatch = pathPattern.exec(optionsText)) !== null) {
                    suggestedPaths.add(pathMatch[1]);
                    log(this.outputChannel, `Found path from identifier pattern: ${pathMatch[1]}`);
                }
                continue;
            }

            // Pattern 4: "Did you mean Module.Class" - extract module
            const didYouMeanMatch = errorMessage.match(/Did you mean ([^`\n]+)/);
            if (didYouMeanMatch) {
                const fullName = didYouMeanMatch[1].trim();
                const lastDotIndex = fullName.lastIndexOf(".");
                if (lastDotIndex > 0) {
                    const namespace = fullName.substring(0, lastDotIndex);
                    // Check if it's an absolute path or relative module
                    if (namespace.startsWith('/')) {
                        suggestedPaths.add(namespace);
                    } else {
                        // For relative modules, we might need to handle them differently
                        // For now, add as-is
                        suggestedPaths.add(namespace);
                    }
                    log(this.outputChannel, `Found path from 'did you mean': ${namespace}`);
                }
            }
        }

        const result = Array.from(suggestedPaths);
        log(this.outputChannel, `Extracted ${result.length} unique import paths from diagnostics`);
        return result;
    }

    /**
     * Converts all import statements in the document to the preferred syntax.
     * This includes imports that are not at the top of the file (e.g., inside namespaces).
     */
    async convertScatteredImportsToPreferredSyntax(document: vscode.TextDocument): Promise<boolean> {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const preferredSyntax = config.get<string>("behavior.importSyntax", "curly");
        const preferDotSyntax = preferredSyntax === "dot";

        log(this.outputChannel, `Converting all imports to ${preferredSyntax} syntax`);

        const text = document.getText();
        const lines = text.split("\n");
        const edits: { line: number; oldText: string; newText: string }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Check for single-line curly syntax
            const curlyMatch = trimmedLine.match(/^(using\s*\{\s*)([^}]+)(\s*\})/);
            if (curlyMatch) {
                const path = curlyMatch[2].trim();
                const currentIsDot = false;

                if (currentIsDot !== preferDotSyntax) {
                    const newStatement = this.formatImportStatement(path, preferDotSyntax);
                    // Preserve indentation
                    const leadingWhitespace = line.match(/^\s*/)?.[0] || "";
                    edits.push({
                        line: i,
                        oldText: line,
                        newText: leadingWhitespace + newStatement
                    });
                    log(this.outputChannel, `Converting line ${i + 1} from curly to ${preferredSyntax}`);
                }
                continue;
            }

            // Check for single-line dot syntax
            const dotMatch = trimmedLine.match(/^(using\.\s*)(.+)/);
            if (dotMatch) {
                const path = dotMatch[2].trim();
                const currentIsDot = true;

                if (currentIsDot !== preferDotSyntax) {
                    const newStatement = this.formatImportStatement(path, preferDotSyntax);
                    // Preserve indentation
                    const leadingWhitespace = line.match(/^\s*/)?.[0] || "";
                    edits.push({
                        line: i,
                        oldText: line,
                        newText: leadingWhitespace + newStatement
                    });
                    log(this.outputChannel, `Converting line ${i + 1} from dot to ${preferredSyntax}`);
                }
                continue;
            }

            // Check for multi-line import (always convert to preferred single-line format)
            if (trimmedLine.match(/^using\s*:\s*$/)) {
                // Look for the next indented path line
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1];
                    const pathMatch = nextLine.match(/^\s+(.+)/);
                    if (pathMatch) {
                        const path = pathMatch[1].trim();
                        const newStatement = this.formatImportStatement(path, preferDotSyntax);
                        // Preserve indentation of the original 'using:' line
                        const leadingWhitespace = line.match(/^\s*/)?.[0] || "";

                        // We need to replace both lines with a single line
                        // For now, just mark them for conversion
                        log(this.outputChannel, `Found multi-line import at lines ${i + 1}-${i + 2}, converting to ${preferredSyntax}`);
                        // This is more complex - we'll handle it in the apply phase
                    }
                }
            }
        }

        if (edits.length === 0) {
            log(this.outputChannel, "No imports need syntax conversion");
            return true;
        }

        // Apply all edits
        const edit = new vscode.WorkspaceEdit();
        for (const e of edits) {
            const range = new vscode.Range(
                new vscode.Position(e.line, 0),
                new vscode.Position(e.line, lines[e.line].length)
            );
            edit.replace(document.uri, range, e.newText);
        }

        try {
            const success = await vscode.workspace.applyEdit(edit);
            log(this.outputChannel, `Converted ${edits.length} import statements. Success: ${success}`);
            return success;
        } catch (error) {
            log(this.outputChannel, `Error converting imports: ${error}`);
            return false;
        }
    }
}
