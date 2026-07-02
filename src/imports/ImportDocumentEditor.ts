import * as vscode from "vscode";
import { logger } from "../utils";
import { ImportFormatter } from "./ImportFormatter";

/** Represents a contiguous block of import statements in the document. */
interface ImportBlock {
    start: number;
    end: number;
    imports: string[];
}

/**
 * Handles all document modifications for imports.
 */
export class ImportDocumentEditor {
    private readonly formatter: ImportFormatter;

    constructor(
        private outputChannel: vscode.OutputChannel,
        formatter: ImportFormatter,
    ) {
        this.formatter = formatter;
    }

    /**
     * Creates an edit to replace an import block with combined and formatted imports.
     */
    private createBlockReplacementEdit(edit: vscode.WorkspaceEdit, document: vscode.TextDocument, block: ImportBlock, newPaths: string[], preferDotSyntax: boolean, sortAlphabetically: boolean): void {
        // Get existing paths in this block for combined sorting
        const existingBlockPaths = block.imports.map((imp) => this.formatter.extractPathFromImport(imp)).filter((p): p is string => p !== null);

        const combinedPaths = [...existingBlockPaths, ...newPaths];
        if (sortAlphabetically) {
            combinedPaths.sort((a, b) => a.localeCompare(b));
        }

        // Format all imports for this block
        const formattedImports = combinedPaths.map((path) => this.formatter.formatImportStatement(path, preferDotSyntax));

        // Replace the entire block
        edit.replace(document.uri, new vscode.Range(new vscode.Position(block.start, 0), new vscode.Position(block.end + 1, 0)), formattedImports.join("\n") + "\n");
    }

    /**
     * Extracts existing import statements from a document.
     */
    extractExistingImports(document: vscode.TextDocument): string[] {
        logger.debug("ImportDocumentEditor", "Extracting existing imports from document");
        const text = document.getText();
        const lines = text.split("\n");
        const imports = new Set<string>();

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            const nextLine = i + 1 < lines.length ? lines[i + 1] : undefined;
            if (ImportFormatter.isModuleImport(trimmed, nextLine)) {
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

        const importBlocks: ImportBlock[] = [];
        let currentBlock: ImportBlock | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const nextLine = i + 1 < lines.length ? lines[i + 1] : undefined;
            if (ImportFormatter.isModuleImport(line, nextLine)) {
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
                    this.createBlockReplacementEdit(edit, document, importBlocks[digestBlockIndex], newDigestPaths, preferDotSyntax, sortAlphabetically);
                }

                // Add local imports to local block
                if (newLocalPaths.length > 0 && localBlockIndex >= 0) {
                    this.createBlockReplacementEdit(edit, document, importBlocks[localBlockIndex], newLocalPaths, preferDotSyntax, sortAlphabetically);
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
     * Computes the document text with every module import consolidated into
     * one organized block at the top: existing imports plus additional paths,
     * deduplicated, grouped, sorted, and formatted per the given options.
     * Handles all three Verse import styles, including the indented pair
     * (`using:` plus the indented path on the next line). Local-scope `using`
     * statements are left where they are. Returns null when the document has
     * no module imports and no additional paths (nothing to organize).
     */
    buildOrganizedContent(
        text: string,
        additionalPaths: string[],
        options: {
            preferDotSyntax: boolean;
            sortAlphabetically: boolean;
            importGrouping: string;
        },
    ): string | null {
        const lines = text.split("\n");
        const paths: string[] = [];
        const body: string[] = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();
            const nextLine = i + 1 < lines.length ? lines[i + 1] : undefined;

            if (ImportFormatter.isModuleImport(trimmed, nextLine)) {
                // Indented style: the path lives on the next line; consume both.
                if (/^using\s*:\s*$/.test(trimmed)) {
                    if (nextLine !== undefined && /^\s+\S/.test(nextLine)) {
                        paths.push(nextLine.trim());
                        i += 2;
                        continue;
                    }
                    i += 1;
                    continue;
                }

                const path = this.formatter.extractPathFromImport(trimmed);
                if (path) {
                    paths.push(path);
                }
                i += 1;
                continue;
            }

            body.push(line);
            i += 1;
        }

        const extraPaths = additionalPaths.map((p) => p.trim()).filter((p) => p.length > 0);
        if (paths.length === 0 && extraPaths.length === 0) {
            return null;
        }

        const uniquePaths = Array.from(new Set([...paths, ...extraPaths]));
        const formatted = this.formatter.groupAndFormatImports(uniquePaths, options.preferDotSyntax, options.sortAlphabetically, options.importGrouping);

        // Drop blank lines the removed imports left at the top; the gap after
        // the block is normalized by ensureEmptyLinesAfterImports afterwards.
        let firstContent = 0;
        while (firstContent < body.length && body[firstContent].trim() === "") {
            firstContent++;
        }
        const remainingBody = body.slice(firstContent);

        if (remainingBody.length === 0) {
            return formatted.join("\n") + "\n";
        }

        return [...formatted, "", ...remainingBody].join("\n");
    }

    /**
     * Rebuilds the document's import block in a single atomic edit: existing
     * imports plus the given additional paths, deduplicated, grouped, sorted,
     * and written in the preferred syntax at the top of the file. Unlike
     * addImportsToDocument this reorganizes even when nothing new is added.
     */
    async organizeImports(document: vscode.TextDocument, additionalPaths: string[]): Promise<boolean> {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const preferDotSyntax = config.get<string>("behavior.importSyntax", "curly") === "dot";
        const sortAlphabetically = config.get<boolean>("behavior.sortImportsAlphabetically", true);
        const importGrouping = config.get<string>("behavior.importGrouping", "none");

        const text = document.getText();
        const organized = this.buildOrganizedContent(text, additionalPaths, {
            preferDotSyntax,
            sortAlphabetically,
            importGrouping,
        });

        if (organized === null || organized === text) {
            logger.debug("ImportDocumentEditor", "No import changes needed by organize");
            return true;
        }

        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(new vscode.Position(0, 0), document.lineAt(document.lineCount - 1).range.end);
        edit.replace(document.uri, fullRange, organized);

        try {
            const success = await vscode.workspace.applyEdit(edit);
            logger.info("ImportDocumentEditor", success ? "Organized imports in document" : "Failed to organize imports");

            if (success) {
                await this.ensureEmptyLinesAfterImports(document);
            }

            return success;
        } catch (error) {
            logger.error("ImportDocumentEditor", `Error organizing imports: ${error}`, error);
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

        // Find the last import line (only module imports, not local-scope using)
        let lastImportLine = -1;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            const nextLine = i + 1 < lines.length ? lines[i + 1] : undefined;
            if (ImportFormatter.isModuleImport(trimmed, nextLine)) {
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
}
