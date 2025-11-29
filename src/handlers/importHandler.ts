import * as vscode from "vscode";
import { logger } from "../utils/logger";
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
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0);

            logger.debug("ImportHandler", `Found ${options.length} multi-options (pattern 1): ${options.join(", ")}`);
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

            logger.debug("ImportHandler", `Found ${options.length} multi-options (pattern 2): ${options.join(", ")}`);
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

            logger.debug("ImportHandler", `Found ${options.length} multi-options (pattern 3): ${options.join(", ")}`);
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
                return options.reduce((shortest, current) => (current.length < shortest.length ? current : shortest));
            case "auto_first":
                return options[0];
            default:
                return options[0]; // fallback
        }
    }

    private createImportSuggestion(importStatement: string, source: ImportSuggestionSource, confidence: ImportConfidence, description?: string): ImportSuggestion {
        const modulePath = this.extractPathFromImport(importStatement);
        return {
            importStatement,
            source,
            confidence,
            description,
            modulePath: modulePath || undefined,
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
                const confidence: ImportConfidence = entry.identifier === identifier ? "high" : "medium";
                const description = `${entry.type} from ${entry.modulePath}`;

                suggestions.push(this.createImportSuggestion(importStatement, "digest_lookup", confidence, description));
            }

            if (suggestions.length > 0) {
                logger.debug("ImportHandler", `Found ${suggestions.length} digest-based suggestions for: ${identifier}`);
            }

            return suggestions;
        } catch (error) {
            logger.error("ImportHandler", `Error looking up identifier in digest`, error);
            return [];
        }
    }

    extractExistingImports(document: vscode.TextDocument): string[] {
        logger.debug("ImportHandler", "Extracting existing imports from document");
        const text = document.getText();
        const lines = text.split("\n");
        const imports = new Set<string>();

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("using")) {
                logger.trace("ImportHandler", `Found import: ${trimmed}`);
                imports.add(trimmed);
            }
        }

        logger.debug("ImportHandler", `Extracted ${imports.size} existing imports`);
        return Array.from(imports);
    }

    async extractImportSuggestions(errorMessage: string): Promise<ImportSuggestion[]> {
        logger.debug("ImportHandler", `Extracting import suggestions from error: ${errorMessage}`);

        // Ignore errors that suggest using 'set' instead of import issues
        if (errorMessage.includes("Did you mean to write 'set")) {
            logger.debug("ImportHandler", `Ignoring 'set' suggestion error`);
            return [];
        }

        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const preferDotSyntax = config.get<string>("behavior.importSyntax", "curly") === "dot";
        const ambiguousImportMappings = config.get<Record<string, string>>("ambiguousImports", {});

        // Check for multi-option "Did you mean any of" pattern first
        const multiOptions = this.parseMultiOptionSuggestions(errorMessage);
        if (multiOptions.length > 0) {
            logger.debug("ImportHandler", `Found multi-option pattern with ${multiOptions.length} options`);
            const suggestions: ImportSuggestion[] = [];

            for (const option of multiOptions) {
                // Check if option is a module path (starts with /)
                if (option.startsWith("/")) {
                    // Direct module path from "using { /Path }" format
                    const importStatement = this.formatImportStatement(option, preferDotSyntax);
                    const moduleName = option.split("/").pop() || option;

                    logger.trace("ImportHandler", `Multi-option (module path): ${option}`);

                    suggestions.push(this.createImportSuggestion(importStatement, "error_message", "high", `Import from ${option}`));
                } else {
                    // Fully qualified class name (e.g., "Module.ClassName")
                    const lastDotIndex = option.lastIndexOf(".");
                    if (lastDotIndex > 0) {
                        const namespace = option.substring(0, lastDotIndex);
                        const className = option.substring(lastDotIndex + 1);
                        const importStatement = this.formatImportStatement(namespace, preferDotSyntax);

                        logger.debug("ImportHandler", `Multi-option: ${option} -> namespace: ${namespace}, class: ${className}`);

                        suggestions.push(this.createImportSuggestion(importStatement, "error_message", "high", `${className} from ${namespace}`));
                    } else {
                        // No namespace detected, treat as simple reference
                        const importStatement = this.formatImportStatement(option, preferDotSyntax);
                        logger.trace("ImportHandler", `Multi-option (no namespace): ${option}`);

                        suggestions.push(this.createImportSuggestion(importStatement, "error_message", "medium", `Import ${option}`));
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
                logger.debug("ImportHandler", `Found specific import suggestion for unknown identifier ${className}: ${importStatement}`);
                return [this.createImportSuggestion(importStatement, "error_message", "high", `Import ${className} from ${path}`)];
            }

            // First check configured ambiguous mappings
            if (ambiguousImportMappings[className]) {
                const preferredPath = ambiguousImportMappings[className];
                const importStatement = this.formatImportStatement(preferredPath, preferDotSyntax);

                logger.debug("ImportHandler", `Using configured path for ambiguous class ${className}: ${importStatement}`);
                return [this.createImportSuggestion(importStatement, "error_message", "high", `Configured import for ${className}`)];
            }

            // Try digest-based lookup for unknown identifier
            const digestSuggestions = await this.lookupIdentifierInDigest(className);
            if (digestSuggestions.length > 0) {
                logger.debug("ImportHandler", `Found digest-based suggestions for unknown identifier: ${className}`);
                return digestSuggestions;
            }
        }

        // Pattern 1: "Did you forget to specify using { /Path }"
        let match = errorMessage.match(/Did you forget to specify (using \{ \/[^}]+ \})/);
        if (match) {
            const path = match[1].match(/using \{ (\/[^}]+) \}/)?.[1];
            if (path) {
                const importStatement = this.formatImportStatement(path, preferDotSyntax);
                logger.debug("ImportHandler", `Found import statement: ${importStatement}`);
                return [this.createImportSuggestion(importStatement, "error_message", "high", `Standard import for ${path}`)];
            }
        }

        // Pattern 2: "Did you mean Namespace.Component" (single option)
        match = errorMessage.match(/Did you mean ([^`\n]+)/);
        if (match) {
            const fullName = match[1].trim();
            const lastDotIndex = fullName.lastIndexOf(".");
            logger.trace("ImportHandler", `Last dot index: ${lastDotIndex} for ${fullName}`);
            if (lastDotIndex > 0) {
                const namespace = fullName.substring(0, lastDotIndex);
                const importStatement = this.formatImportStatement(namespace, preferDotSyntax);
                logger.debug("ImportHandler", `Inferred import statement: ${importStatement}`);
                return [this.createImportSuggestion(importStatement, "error_message", "high", `Inferred import for ${fullName}`)];
            }
        }

        logger.debug("ImportHandler", "No import suggestions found in error message");
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
        logger.info("ImportHandler", `Adding ${importStatements.length} import statements to document`);

        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const preferDotSyntax = config.get<string>("behavior.importSyntax", "curly") === "dot";
        const preserveImportLocations = config.get<boolean>("behavior.preserveImportLocations", false);
        const sortAlphabetically = config.get<boolean>("behavior.sortImportsAlphabetically", true);
        const importGrouping = config.get<string>("behavior.importGrouping", "none");

        logger.debug("ImportHandler", `Import statements received:${preserveImportLocations ? " (locations will be preserved)" : ""} Sort: ${sortAlphabetically} Grouping: ${importGrouping}`);
        importStatements.forEach((statement) => {
            logger.debug("ImportHandler", `- ${statement}`);
        });

        const text = document.getText();
        const lines = text.split("\n");
        const existingImports = new Set<string>();

        const importBlocks: { start: number; end: number; imports: string[] }[] = [];
        let currentBlock: { start: number; end: number; imports: string[] } | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("using")) {
                logger.debug("ImportHandler", `Found existing import at line ${i}: ${line}`);

                existingImports.add(line);

                if (!currentBlock) {
                    currentBlock = { start: i, end: i, imports: [line] };
                } else if (i === currentBlock.end + 1) {
                    // Only extend block if import immediately follows (no gap)
                    currentBlock.end = i;
                    currentBlock.imports.push(line);
                } else {
                    // Any gap creates a new block
                    importBlocks.push(currentBlock);
                    currentBlock = { start: i, end: i, imports: [line] };
                }
            }
        }

        if (currentBlock) {
            importBlocks.push(currentBlock);
        }

        logger.debug("ImportHandler", `Found ${existingImports.size} existing imports in ${importBlocks.length} blocks`);

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
                logger.debug("ImportHandler", `New import needed: ${path}`);
                newImportPaths.add(path);
            }
        });

        if (newImportPaths.size === 0) {
            logger.debug("ImportHandler", "No new imports needed, skipping update");
            return true;
        }

        const edit = new vscode.WorkspaceEdit();

        if (preserveImportLocations) {
            // Check if existing imports are grouped (2+ blocks with gap between them)
            const hasGrouping =
                importGrouping !== "none" &&
                importBlocks.length >= 2 &&
                importBlocks.some((block, i) => {
                    if (i === 0) return false;
                    // Check if there's a gap between this block and the previous one
                    return block.start > importBlocks[i - 1].end + 1;
                });

            if (hasGrouping && importBlocks.length >= 2) {
                // Analyze existing blocks to determine which is digest and which is local
                let digestBlockIndex = -1;
                let localBlockIndex = -1;

                importBlocks.forEach((block, index) => {
                    const blockPaths = block.imports.map((imp) => this.extractPathFromImport(imp)).filter((p) => p);
                    const hasDigest = blockPaths.some((path) => this.isDigestImport(path));
                    const hasLocal = blockPaths.some((path) => !this.isDigestImport(path));

                    // Determine block type based on majority
                    if (hasDigest && !hasLocal) {
                        digestBlockIndex = index;
                    } else if (hasLocal && !hasDigest) {
                        localBlockIndex = index;
                    }
                });

                // Separate new imports into digest and local
                const newDigestPaths: string[] = [];
                const newLocalPaths: string[] = [];

                for (const path of newImportPaths) {
                    if (this.isDigestImport(path)) {
                        newDigestPaths.push(path);
                    } else {
                        newLocalPaths.push(path);
                    }
                }

                // Add digest imports to digest block
                if (newDigestPaths.length > 0 && digestBlockIndex >= 0) {
                    const block = importBlocks[digestBlockIndex];
                    // Get existing paths in this block for combined sorting
                    const existingBlockPaths = block.imports.map((imp) => this.extractPathFromImport(imp)).filter((p) => p) as string[];

                    const combinedPaths = [...existingBlockPaths, ...newDigestPaths];
                    if (sortAlphabetically) {
                        combinedPaths.sort((a, b) => a.localeCompare(b));
                    }

                    // Format all imports for this block
                    const formattedImports = combinedPaths.map((path) => this.formatImportStatement(path, preferDotSyntax));

                    // Replace the entire block
                    edit.replace(document.uri, new vscode.Range(new vscode.Position(block.start, 0), new vscode.Position(block.end + 1, 0)), formattedImports.join("\n") + "\n");
                }

                // Add local imports to local block
                if (newLocalPaths.length > 0 && localBlockIndex >= 0) {
                    const block = importBlocks[localBlockIndex];
                    // Get existing paths in this block for combined sorting
                    const existingBlockPaths = block.imports.map((imp) => this.extractPathFromImport(imp)).filter((p) => p) as string[];

                    const combinedPaths = [...existingBlockPaths, ...newLocalPaths];
                    if (sortAlphabetically) {
                        combinedPaths.sort((a, b) => a.localeCompare(b));
                    }

                    // Format all imports for this block
                    const formattedImports = combinedPaths.map((path) => this.formatImportStatement(path, preferDotSyntax));

                    // Replace the entire block
                    edit.replace(document.uri, new vscode.Range(new vscode.Position(block.start, 0), new vscode.Position(block.end + 1, 0)), formattedImports.join("\n") + "\n");
                }

                // Handle imports that don't have a matching block
                const unhandledDigest = digestBlockIndex < 0 ? newDigestPaths : [];
                const unhandledLocal = localBlockIndex < 0 ? newLocalPaths : [];
                const unhandledPaths = [...unhandledDigest, ...unhandledLocal];

                if (unhandledPaths.length > 0) {
                    const unhandledImports = this.groupAndFormatImports(unhandledPaths, preferDotSyntax, sortAlphabetically, importGrouping);

                    // Add unhandled imports at the appropriate position
                    if (importBlocks.length > 0) {
                        edit.insert(document.uri, new vscode.Position(importBlocks[importBlocks.length - 1].end + 1, 0), unhandledImports.join("\n") + "\n");
                    } else {
                        edit.insert(document.uri, new vscode.Position(0, 0), unhandledImports.join("\n") + "\n\n");
                    }
                }
            } else {
                // Either no existing grouping or need to create initial groups
                if (importGrouping !== "none" && existingPaths.size > 0) {
                    // We have existing imports but no grouping - reorganize everything into groups
                    const allPaths = new Set<string>([...existingPaths, ...newImportPaths]);
                    const allImportsArray = Array.from(allPaths);
                    const groupedImports = this.groupAndFormatImports(allImportsArray, preferDotSyntax, sortAlphabetically, importGrouping);

                    // Replace all existing imports with grouped version
                    if (importBlocks.length > 0) {
                        // Delete all existing import blocks
                        for (let i = importBlocks.length - 1; i >= 0; i--) {
                            const block = importBlocks[i];
                            edit.delete(document.uri, new vscode.Range(new vscode.Position(block.start, 0), new vscode.Position(block.end + 1, 0)));
                        }
                    }

                    // Insert grouped imports at the top
                    edit.insert(document.uri, new vscode.Position(0, 0), groupedImports.join("\n") + "\n\n");
                } else {
                    // No grouping or no existing imports - use original behavior
                    const newImportPathsArray = Array.from(newImportPaths);
                    const newImports = this.groupAndFormatImports(newImportPathsArray, preferDotSyntax, sortAlphabetically, importGrouping);

                    if (importBlocks.length > 0 && importBlocks[0].start === 0) {
                        edit.insert(document.uri, new vscode.Position(importBlocks[0].end + 1, 0), newImports.join("\n") + "\n");
                    } else {
                        edit.insert(document.uri, new vscode.Position(0, 0), newImports.join("\n") + "\n\n");
                    }
                }
            }
        } else {
            // Consolidate all imports at the top
            const allPaths = new Set<string>([...existingPaths, ...newImportPaths]);
            const allImportsArray = Array.from(allPaths);

            // Use the new grouping method for all imports
            const formattedImports = this.groupAndFormatImports(allImportsArray, preferDotSyntax, sortAlphabetically, importGrouping);

            // Insert imports at top with minimal spacing (will be fixed by ensureEmptyLinesAfterImports)
            const importsText = formattedImports.join("\n") + "\n";
            edit.insert(document.uri, new vscode.Position(0, 0), importsText);

            // Remove existing import blocks (in reverse order to maintain line numbers)
            for (let i = importBlocks.length - 1; i >= 0; i--) {
                const block = importBlocks[i];
                edit.delete(document.uri, new vscode.Range(new vscode.Position(block.start, 0), new vscode.Position(block.end + 1, 0)));
            }
        }

        try {
            const success = await vscode.workspace.applyEdit(edit);
            logger.info("ImportHandler", success ? "Successfully updated imports in document" : "Failed to update imports in document");

            // After adding imports, ensure proper spacing
            if (success) {
                await this.ensureEmptyLinesAfterImports(document);
            }

            return success;
        } catch (error) {
            logger.error("ImportHandler", `Error updating imports: ${error}`, error);
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
        if (importPath.includes("using")) {
            path = this.extractPathFromImport(importPath) || importPath;
        }

        // Get configurable digest prefixes
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const digestPrefixes = config.get<string[]>("behavior.digestImportPrefixes", [
            "/Verse.org/",
            "/Fortnite.com/",
            "/UnrealEngine.com/"
        ]);

        // Check if it's a digest import
        return digestPrefixes.some(prefix => path.startsWith(prefix));
    }

    /**
     * Groups and formats imports based on the configuration settings
     * @param importPaths Array of import paths to group and format
     * @param preferDotSyntax Whether to use dot syntax for imports
     * @param sortAlphabetically Whether to sort imports alphabetically
     * @param importGrouping The grouping strategy ('none', 'digestFirst', or 'localFirst')
     * @returns Array of formatted import statements with potential empty lines for grouping
     */
    private groupAndFormatImports(importPaths: string[], preferDotSyntax: boolean, sortAlphabetically: boolean, importGrouping: string): string[] {
        if (importGrouping === "none") {
            // Legacy behavior: simple alphabetical sort if enabled
            const sortedPaths = sortAlphabetically ? [...importPaths].sort((a, b) => a.localeCompare(b)) : importPaths;
            return sortedPaths.map((path) => this.formatImportStatement(path, preferDotSyntax));
        }

        // New grouping behavior: separate digest and local imports
        const digestImports: string[] = [];
        const localImports: string[] = [];

        for (const path of importPaths) {
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
        const formattedDigestImports = digestImports.map((path) => this.formatImportStatement(path, preferDotSyntax));
        const formattedLocalImports = localImports.map((path) => this.formatImportStatement(path, preferDotSyntax));

        // Combine based on configuration
        let formattedImports: string[] = [];
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

        return formattedImports;
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
        logger.info("ImportHandler", "Removing all imports from document");

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
                logger.trace("ImportHandler", `Removing single-line import at line ${i + 1}: ${trimmedLine}`);
                removedCount++;
                i++;
                continue;
            }

            // Check for multi-line import start
            if (trimmedLine.match(/^using\s*:\s*$/)) {
                logger.trace("ImportHandler", `Found multi-line import start at line ${i + 1}`);
                removedCount++;
                i++;

                // Skip the next indented path line
                if (i < lines.length) {
                    const nextLine = lines[i];
                    // Check if next line is indented (has leading whitespace)
                    if (nextLine.match(/^\s+.+/)) {
                        logger.trace("ImportHandler", `Removing indented path at line ${i + 1}: ${nextLine.trim()}`);
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
            logger.debug("ImportHandler", "No imports found to remove");
            return true;
        }

        // Apply the edit to replace entire document
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(new vscode.Position(0, 0), document.lineAt(document.lineCount - 1).range.end);

        edit.replace(document.uri, fullRange, resultLines.join("\n"));

        try {
            const success = await vscode.workspace.applyEdit(edit);
            logger.debug("ImportHandler", `Removed ${removedCount} import statements. Success: ${success}`);
            return success;
        } catch (error) {
            logger.error("ImportHandler", `Error removing imports: ${error}`, error);
            return false;
        }
    }

    /**
     * Extracts import suggestions from VS Code diagnostics.
     * Parses error messages to find missing imports.
     */
    extractImportsFromDiagnostics(diagnostics: vscode.Diagnostic[]): string[] {
        logger.debug("ImportHandler", `Extracting imports from ${diagnostics.length} diagnostics`);

        const suggestedPaths = new Set<string>();

        for (const diagnostic of diagnostics) {
            const errorMessage = diagnostic.message;

            // Skip non-import related errors
            if (!errorMessage.includes("using") && !errorMessage.includes("Unknown identifier") && !errorMessage.includes("Did you forget") && !errorMessage.includes("Did you mean")) {
                continue;
            }

            // Pattern 0: "Unknown identifier `x`. Did you forget to specify using { /Path }" (combined pattern)
            const unknownWithSuggestionMatch = errorMessage.match(/Unknown identifier `[^`]+`.*Did you forget to specify using \{ (\/[^}]+) \}/s);
            if (unknownWithSuggestionMatch) {
                suggestedPaths.add(unknownWithSuggestionMatch[1]);
                logger.debug("ImportHandler", `Found path from unknown identifier with suggestion: ${unknownWithSuggestionMatch[1]}`);
                continue;
            }

            // Pattern 1: "Did you forget to specify using { /Path }"
            const forgetMatch = errorMessage.match(/Did you forget to specify using \{ (\/[^}]+) \}/);
            if (forgetMatch) {
                suggestedPaths.add(forgetMatch[1]);
                logger.debug("ImportHandler", `Found path from 'forget' pattern: ${forgetMatch[1]}`);
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
                    logger.debug("ImportHandler", `Found path from multi-option: ${usingMatch[1]}`);
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
                    logger.debug("ImportHandler", `Found path from identifier pattern: ${pathMatch[1]}`);
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
                    if (namespace.startsWith("/")) {
                        suggestedPaths.add(namespace);
                    } else {
                        // For relative modules, we might need to handle them differently
                        // For now, add as-is
                        suggestedPaths.add(namespace);
                    }
                    logger.debug("ImportHandler", `Found path from 'did you mean': ${namespace}`);
                }
            }
        }

        const result = Array.from(suggestedPaths);
        logger.debug("ImportHandler", `Extracted ${result.length} unique import paths from diagnostics`);
        return result;
    }

    /**
     * Ensures the proper number of empty lines exists after the last import statement.
     * This method is called when saving files, adding imports, or optimizing imports.
     */
    async ensureEmptyLinesAfterImports(document: vscode.TextDocument): Promise<boolean> {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const emptyLinesAfterImports = config.get<number>("behavior.emptyLinesAfterImports", 1);

        logger.debug("ImportHandler", `Ensuring ${emptyLinesAfterImports} empty lines after imports`);

        const text = document.getText();
        const lines = text.split("\n");

        // Find the last import line
        let lastImportLine = -1;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith("using")) {
                lastImportLine = i;

                // Handle multi-line imports (using: format)
                if (trimmed.match(/^using\s*:\s*$/)) {
                    // Check if next line is indented (part of multi-line import)
                    if (i + 1 < lines.length && lines[i + 1].match(/^\s+.+/)) {
                        lastImportLine = i + 1;
                    }
                }
            }
        }

        // If no imports found or file only has imports, nothing to do
        if (lastImportLine === -1 || lastImportLine === lines.length - 1) {
            logger.debug("ImportHandler", "No imports found or file ends with imports, skipping spacing adjustment");
            return true;
        }

        // Count existing empty lines after the last import
        let existingEmptyLines = 0;
        for (let i = lastImportLine + 1; i < lines.length; i++) {
            if (lines[i].trim() === "") {
                existingEmptyLines++;
            } else {
                break;
            }
        }

        // Check if there's non-import content after the imports
        let hasContentAfterImports = false;
        for (let i = lastImportLine + 1; i < lines.length; i++) {
            if (lines[i].trim() !== "") {
                hasContentAfterImports = true;
                break;
            }
        }

        // Only adjust if there's content after imports
        if (!hasContentAfterImports) {
            logger.debug("ImportHandler", "No content after imports, skipping spacing adjustment");
            return true;
        }

        // Calculate adjustment needed
        const lineDifference = emptyLinesAfterImports - existingEmptyLines;

        if (lineDifference === 0) {
            logger.debug("ImportHandler", `Already has ${emptyLinesAfterImports} empty lines after imports`);
            return true;
        }

        const edit = new vscode.WorkspaceEdit();

        if (lineDifference > 0) {
            // Need to add empty lines
            const newLines = "\n".repeat(lineDifference);
            const insertPosition = new vscode.Position(lastImportLine + 1, 0);
            edit.insert(document.uri, insertPosition, newLines);
            logger.info("ImportHandler", `Adding ${lineDifference} empty lines after imports`);
        } else {
            // Need to remove empty lines
            const linesToRemove = Math.abs(lineDifference);
            const startLine = lastImportLine + 1;
            const endLine = Math.min(startLine + linesToRemove, lines.length);
            const range = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, 0));
            edit.delete(document.uri, range);
            logger.info("ImportHandler", `Removing ${linesToRemove} empty lines after imports`);
        }

        try {
            const success = await vscode.workspace.applyEdit(edit);
            logger.info("ImportHandler", success ? "Successfully adjusted spacing after imports" : "Failed to adjust spacing");
            return success;
        } catch (error) {
            logger.error("ImportHandler", `Error adjusting spacing: ${error}`, error);
            return false;
        }
    }

    /**
     * Converts all import statements in the document to the preferred syntax.
     * This includes imports that are not at the top of the file (e.g., inside namespaces).
     */
    async convertScatteredImportsToPreferredSyntax(document: vscode.TextDocument): Promise<boolean> {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const preferredSyntax = config.get<string>("behavior.importSyntax", "curly");
        const preferDotSyntax = preferredSyntax === "dot";

        logger.info("ImportHandler", `Converting all imports to ${preferredSyntax} syntax`);

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
                        newText: leadingWhitespace + newStatement,
                    });
                    logger.trace("ImportHandler", `Converting line ${i + 1} from curly to ${preferredSyntax}`);
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
                        newText: leadingWhitespace + newStatement,
                    });
                    logger.trace("ImportHandler", `Converting line ${i + 1} from dot to ${preferredSyntax}`);
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
                        logger.trace("ImportHandler", `Found multi-line import at lines ${i + 1}-${i + 2}, converting to ${preferredSyntax}`);
                        // This is more complex - we'll handle it in the apply phase
                    }
                }
            }
        }

        if (edits.length === 0) {
            logger.debug("ImportHandler", "No imports need syntax conversion");
            return true;
        }

        // Apply all edits
        const edit = new vscode.WorkspaceEdit();
        for (const e of edits) {
            const range = new vscode.Range(new vscode.Position(e.line, 0), new vscode.Position(e.line, lines[e.line].length));
            edit.replace(document.uri, range, e.newText);
        }

        try {
            const success = await vscode.workspace.applyEdit(edit);
            logger.debug("ImportHandler", `Converted ${edits.length} import statements. Success: ${success}`);
            return success;
        } catch (error) {
            logger.error("ImportHandler", `Error converting imports: ${error}`, error);
            return false;
        }
    }
}
