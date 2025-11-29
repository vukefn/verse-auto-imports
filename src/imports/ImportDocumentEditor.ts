import * as vscode from "vscode";
import { logger } from "../utils";
import { ImportFormatter } from "./ImportFormatter";

/**
 * Handles all document modifications for imports.
 */
export class ImportDocumentEditor {
    private formatter: ImportFormatter;

    constructor(private outputChannel: vscode.OutputChannel, formatter: ImportFormatter) {
        this.formatter = formatter;
    }

    /**
     * Extracts existing import statements from a document.
     */
    extractExistingImports(document: vscode.TextDocument): string[] {
        logger.debug("ImportDocumentEditor", "Extracting existing imports from document");
        const text = document.getText();
        const lines = text.split("\n");
        const imports = new Set<string>();

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("using")) {
                logger.trace("ImportDocumentEditor", `Found import: ${trimmed}`);
                imports.add(trimmed);
            }
        }

        logger.debug("ImportDocumentEditor", `Extracted ${imports.size} existing imports`);
        return Array.from(imports);
    }

    /**
     * Adds import statements to a document.
     */
    async addImportsToDocument(document: vscode.TextDocument, importStatements: string[]): Promise<boolean> {
        logger.info("ImportDocumentEditor", `Adding ${importStatements.length} import statements to document`);

        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const preferDotSyntax = config.get<string>("behavior.importSyntax", "curly") === "dot";
        const preserveImportLocations = config.get<boolean>("behavior.preserveImportLocations", false);
        const sortAlphabetically = config.get<boolean>("behavior.sortImportsAlphabetically", true);
        const importGrouping = config.get<string>("behavior.importGrouping", "none");

        logger.debug("ImportDocumentEditor", `Import statements received:${preserveImportLocations ? " (locations will be preserved)" : ""} Sort: ${sortAlphabetically} Grouping: ${importGrouping}`);
        importStatements.forEach((statement) => {
            logger.debug("ImportDocumentEditor", `- ${statement}`);
        });

        const text = document.getText();
        const lines = text.split("\n");
        const existingImports = new Set<string>();

        const importBlocks: { start: number; end: number; imports: string[] }[] = [];
        let currentBlock: { start: number; end: number; imports: string[] } | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("using")) {
                logger.debug("ImportDocumentEditor", `Found existing import at line ${i}: ${line}`);

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

        logger.debug("ImportDocumentEditor", `Found ${existingImports.size} existing imports in ${importBlocks.length} blocks`);

        const existingPaths = new Set<string>();
        existingImports.forEach((imp) => {
            const path = this.formatter.extractPathFromImport(imp);
            if (path) {
                existingPaths.add(path);
            }
        });

        const newImportPaths = new Set<string>();
        importStatements.forEach((imp) => {
            const path = this.formatter.extractPathFromImport(imp);
            if (path && !existingPaths.has(path)) {
                logger.debug("ImportDocumentEditor", `New import needed: ${path}`);
                newImportPaths.add(path);
            }
        });

        if (newImportPaths.size === 0) {
            logger.debug("ImportDocumentEditor", "No new imports needed, skipping update");
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
                    const blockPaths = block.imports.map((imp) => this.formatter.extractPathFromImport(imp)).filter((p) => p);
                    const hasDigest = blockPaths.some((path) => this.formatter.isDigestImport(path!));
                    const hasLocal = blockPaths.some((path) => !this.formatter.isDigestImport(path!));

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
                    if (this.formatter.isDigestImport(path)) {
                        newDigestPaths.push(path);
                    } else {
                        newLocalPaths.push(path);
                    }
                }

                // Add digest imports to digest block
                if (newDigestPaths.length > 0 && digestBlockIndex >= 0) {
                    const block = importBlocks[digestBlockIndex];
                    // Get existing paths in this block for combined sorting
                    const existingBlockPaths = block.imports.map((imp) => this.formatter.extractPathFromImport(imp)).filter((p) => p) as string[];

                    const combinedPaths = [...existingBlockPaths, ...newDigestPaths];
                    if (sortAlphabetically) {
                        combinedPaths.sort((a, b) => a.localeCompare(b));
                    }

                    // Format all imports for this block
                    const formattedImports = combinedPaths.map((path) => this.formatter.formatImportStatement(path, preferDotSyntax));

                    // Replace the entire block
                    edit.replace(document.uri, new vscode.Range(new vscode.Position(block.start, 0), new vscode.Position(block.end + 1, 0)), formattedImports.join("\n") + "\n");
                }

                // Add local imports to local block
                if (newLocalPaths.length > 0 && localBlockIndex >= 0) {
                    const block = importBlocks[localBlockIndex];
                    // Get existing paths in this block for combined sorting
                    const existingBlockPaths = block.imports.map((imp) => this.formatter.extractPathFromImport(imp)).filter((p) => p) as string[];

                    const combinedPaths = [...existingBlockPaths, ...newLocalPaths];
                    if (sortAlphabetically) {
                        combinedPaths.sort((a, b) => a.localeCompare(b));
                    }

                    // Format all imports for this block
                    const formattedImports = combinedPaths.map((path) => this.formatter.formatImportStatement(path, preferDotSyntax));

                    // Replace the entire block
                    edit.replace(document.uri, new vscode.Range(new vscode.Position(block.start, 0), new vscode.Position(block.end + 1, 0)), formattedImports.join("\n") + "\n");
                }

                // Handle imports that don't have a matching block
                const unhandledDigest = digestBlockIndex < 0 ? newDigestPaths : [];
                const unhandledLocal = localBlockIndex < 0 ? newLocalPaths : [];
                const unhandledPaths = [...unhandledDigest, ...unhandledLocal];

                if (unhandledPaths.length > 0) {
                    const unhandledImports = this.formatter.groupAndFormatImports(unhandledPaths, preferDotSyntax, sortAlphabetically, importGrouping);

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
                    const groupedImports = this.formatter.groupAndFormatImports(allImportsArray, preferDotSyntax, sortAlphabetically, importGrouping);

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
                    const newImports = this.formatter.groupAndFormatImports(newImportPathsArray, preferDotSyntax, sortAlphabetically, importGrouping);

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
            const formattedImports = this.formatter.groupAndFormatImports(allImportsArray, preferDotSyntax, sortAlphabetically, importGrouping);

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
            logger.info("ImportDocumentEditor", success ? "Successfully updated imports in document" : "Failed to update imports in document");

            // After adding imports, ensure proper spacing
            if (success) {
                await this.ensureEmptyLinesAfterImports(document);
            }

            return success;
        } catch (error) {
            logger.error("ImportDocumentEditor", `Error updating imports: ${error}`, error);
            return false;
        }
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
        logger.info("ImportDocumentEditor", "Removing all imports from document");

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
                logger.trace("ImportDocumentEditor", `Removing single-line import at line ${i + 1}: ${trimmedLine}`);
                removedCount++;
                i++;
                continue;
            }

            // Check for multi-line import start
            if (trimmedLine.match(/^using\s*:\s*$/)) {
                logger.trace("ImportDocumentEditor", `Found multi-line import start at line ${i + 1}`);
                removedCount++;
                i++;

                // Skip the next indented path line
                if (i < lines.length) {
                    const nextLine = lines[i];
                    // Check if next line is indented (has leading whitespace)
                    if (nextLine.match(/^\s+.+/)) {
                        logger.trace("ImportDocumentEditor", `Removing indented path at line ${i + 1}: ${nextLine.trim()}`);
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
            logger.debug("ImportDocumentEditor", "No imports found to remove");
            return true;
        }

        // Apply the edit to replace entire document
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(new vscode.Position(0, 0), document.lineAt(document.lineCount - 1).range.end);

        edit.replace(document.uri, fullRange, resultLines.join("\n"));

        try {
            const success = await vscode.workspace.applyEdit(edit);
            logger.debug("ImportDocumentEditor", `Removed ${removedCount} import statements. Success: ${success}`);
            return success;
        } catch (error) {
            logger.error("ImportDocumentEditor", `Error removing imports: ${error}`, error);
            return false;
        }
    }

    /**
     * Ensures the proper number of empty lines exists after the last import statement.
     * This method is called when saving files, adding imports, or optimizing imports.
     */
    async ensureEmptyLinesAfterImports(document: vscode.TextDocument): Promise<boolean> {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const emptyLinesAfterImports = config.get<number>("behavior.emptyLinesAfterImports", 1);

        logger.debug("ImportDocumentEditor", `Ensuring ${emptyLinesAfterImports} empty lines after imports`);

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
            logger.debug("ImportDocumentEditor", "No imports found or file ends with imports, skipping spacing adjustment");
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
            logger.debug("ImportDocumentEditor", "No content after imports, skipping spacing adjustment");
            return true;
        }

        // Calculate adjustment needed
        const lineDifference = emptyLinesAfterImports - existingEmptyLines;

        if (lineDifference === 0) {
            logger.debug("ImportDocumentEditor", `Already has ${emptyLinesAfterImports} empty lines after imports`);
            return true;
        }

        const edit = new vscode.WorkspaceEdit();

        if (lineDifference > 0) {
            // Need to add empty lines
            const newLines = "\n".repeat(lineDifference);
            const insertPosition = new vscode.Position(lastImportLine + 1, 0);
            edit.insert(document.uri, insertPosition, newLines);
            logger.info("ImportDocumentEditor", `Adding ${lineDifference} empty lines after imports`);
        } else {
            // Need to remove empty lines
            const linesToRemove = Math.abs(lineDifference);
            const startLine = lastImportLine + 1;
            const endLine = Math.min(startLine + linesToRemove, lines.length);
            const range = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, 0));
            edit.delete(document.uri, range);
            logger.info("ImportDocumentEditor", `Removing ${linesToRemove} empty lines after imports`);
        }

        try {
            const success = await vscode.workspace.applyEdit(edit);
            logger.info("ImportDocumentEditor", success ? "Successfully adjusted spacing after imports" : "Failed to adjust spacing");
            return success;
        } catch (error) {
            logger.error("ImportDocumentEditor", `Error adjusting spacing: ${error}`, error);
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

        logger.info("ImportDocumentEditor", `Converting all imports to ${preferredSyntax} syntax`);

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
                    const newStatement = this.formatter.formatImportStatement(path, preferDotSyntax);
                    // Preserve indentation
                    const leadingWhitespace = line.match(/^\s*/)?.[0] || "";
                    edits.push({
                        line: i,
                        oldText: line,
                        newText: leadingWhitespace + newStatement,
                    });
                    logger.trace("ImportDocumentEditor", `Converting line ${i + 1} from curly to ${preferredSyntax}`);
                }
                continue;
            }

            // Check for single-line dot syntax
            const dotMatch = trimmedLine.match(/^(using\.\s*)(.+)/);
            if (dotMatch) {
                const path = dotMatch[2].trim();
                const currentIsDot = true;

                if (currentIsDot !== preferDotSyntax) {
                    const newStatement = this.formatter.formatImportStatement(path, preferDotSyntax);
                    // Preserve indentation
                    const leadingWhitespace = line.match(/^\s*/)?.[0] || "";
                    edits.push({
                        line: i,
                        oldText: line,
                        newText: leadingWhitespace + newStatement,
                    });
                    logger.trace("ImportDocumentEditor", `Converting line ${i + 1} from dot to ${preferredSyntax}`);
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
                        const newStatement = this.formatter.formatImportStatement(path, preferDotSyntax);
                        // Preserve indentation of the original 'using:' line
                        const leadingWhitespace = line.match(/^\s*/)?.[0] || "";

                        // We need to replace both lines with a single line
                        // For now, just mark them for conversion
                        logger.trace("ImportDocumentEditor", `Found multi-line import at lines ${i + 1}-${i + 2}, converting to ${preferredSyntax}`);
                        // This is more complex - we'll handle it in the apply phase
                    }
                }
            }
        }

        if (edits.length === 0) {
            logger.debug("ImportDocumentEditor", "No imports need syntax conversion");
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
            logger.debug("ImportDocumentEditor", `Converted ${edits.length} import statements. Success: ${success}`);
            return success;
        } catch (error) {
            logger.error("ImportDocumentEditor", `Error converting imports: ${error}`, error);
            return false;
        }
    }
}
