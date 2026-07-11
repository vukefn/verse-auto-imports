import * as vscode from "vscode";
import { logger } from "../utils";
import { ProjectPathHandler } from "../project";
import { ProjectPathData, ProjectPathNode, ProjectScanOptions } from "../types";

/** Number of .verse files parsed concurrently during a full scan. */
const SCAN_CONCURRENCY = 8;

/**
 * Scans .verse files in the project and extracts module, class, struct,
 * function, and variable declarations as a flat node list.
 */
export class ProjectPathScanner {
    constructor(
        private outputChannel: vscode.OutputChannel,
        private projectPathHandler: ProjectPathHandler,
    ) {}

    /**
     * Scans all .verse files in the workspace and returns the project's
     * declaration data, or null when no UEFN project is found.
     */
    async scanProject(workspaceFolder: vscode.WorkspaceFolder, options: ProjectScanOptions = {}): Promise<ProjectPathData | null> {
        const startTime = Date.now();
        logger.info("ProjectPathScanner", `Scanning project ${workspaceFolder.name}...`);

        try {
            const projectVersePath = await this.projectPathHandler.getProjectVersePath();
            const projectName = await this.projectPathHandler.getProjectName();

            if (!projectName) {
                logger.warn("ProjectPathScanner", "No UEFN project found in workspace");
                return null;
            }

            const includePattern = options.includePatterns?.[0] || "**/*.verse";
            const excludePatterns = options.excludePatterns || ["**/node_modules/**", "**/.git/**"];
            const excludePattern = `{${excludePatterns.join(",")}}`;

            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, includePattern), excludePattern);

            logger.debug("ProjectPathScanner", `Found ${files.length} .verse files`);

            const nodes: ProjectPathNode[] = [];
            let processedCount = 0;

            for (let i = 0; i < files.length; i += SCAN_CONCURRENCY) {
                const batch = files.slice(i, i + SCAN_CONCURRENCY);
                const batchResults = await Promise.all(
                    batch.map(async (fileUri) => {
                        try {
                            return await this.parseVerseFile(fileUri, workspaceFolder, options);
                        } catch (error) {
                            logger.error("ProjectPathScanner", `Error parsing ${fileUri.fsPath}`, error);
                            return [];
                        }
                    }),
                );

                for (let j = 0; j < batch.length; j++) {
                    nodes.push(...batchResults[j]);
                    processedCount++;
                    if (options.onProgress) {
                        const relativePath = vscode.workspace.asRelativePath(batch[j], false);
                        options.onProgress(processedCount, files.length, relativePath);
                    }
                }
            }

            const elapsed = Date.now() - startTime;
            logger.info("ProjectPathScanner", `Scanned ${nodes.length} declarations from ${files.length} files in ${elapsed}ms`);

            return {
                projectVersePath: projectVersePath || `/${projectName}`,
                projectName,
                generatedAt: Date.now(),
                nodes,
            };
        } catch (error) {
            logger.error("ProjectPathScanner", "Failed to scan project", error);
            return null;
        }
    }

    /**
     * Parses a single .verse file and extracts declarations.
     */
    async parseVerseFile(fileUri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder, options: ProjectScanOptions = {}): Promise<ProjectPathNode[]> {
        try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            const content = document.getText();
            const relativePath = vscode.workspace.asRelativePath(fileUri, false);

            return this.extractDeclarations(content, relativePath, options);
        } catch (error) {
            logger.error("ProjectPathScanner", `Failed to parse ${fileUri.fsPath}`, error);
            return [];
        }
    }

    /**
     * Extracts module, class, struct, and function declarations from Verse content.
     */
    extractDeclarations(content: string, filePath: string, options: ProjectScanOptions = {}): ProjectPathNode[] {
        const nodes: ProjectPathNode[] = [];
        const lines = content.split("\n");

        // Track current module context with indentation levels
        let currentModulePath = "";
        const moduleStack: { name: string; indent: number }[] = [];

        // Visibility specifiers in Verse: public, protected, private, internal, scoped
        const visibilitySpecifiers = "public|protected|private|internal|scoped";

        // Helper to extract visibility from specifier string like "<native><public>"
        const extractVisibility = (specifiers: string | undefined): string | undefined => {
            if (!specifiers) return undefined;
            const match = specifiers.match(new RegExp(`<(${visibilitySpecifiers})>`));
            return match ? match[1] : undefined;
        };

        // Helper to check if a declaration should be skipped based on visibility
        const shouldSkipDeclaration = (visibility: string | undefined, isModuleType: boolean = false): boolean => {
            if (!options.includePrivate && visibility === "private") {
                return true;
            }
            // Modules have special logic: include public and internal (no visibility = internal)
            if (isModuleType) {
                const isPublic = visibility === "public";
                const isInternal = !visibility || visibility === "internal";
                if (!options.includePrivate && !isPublic && !isInternal) {
                    return true;
                }
            }
            return false;
        };

        // Patterns for declarations
        // Format: Name<specifier1><specifier2>... := type<typespec>...(parent):
        // Captures: [1] = name, [2] = all specifiers after name (may contain visibility)
        const modulePattern = /^(\w+)((?:<[^>]+>)*)\s*:=\s*module\s*:/;
        const classPattern = /^(\w+)((?:<[^>]+>)*)\s*:=\s*class\s*(?:<[^>]+>)*\s*[\(:]?/;
        const structPattern = /^(\w+)((?:<[^>]+>)*)\s*:=\s*struct\s*(?:<[^>]+>)*\s*[\(:]?/;
        const interfacePattern = /^(\w+)((?:<[^>]+>)*)\s*:=\s*interface\s*(?:<[^>]+>)*\s*[\(:]?/;
        const enumPattern = /^(\w+)((?:<[^>]+>)*)\s*:=\s*enum\s*(?:<[^>]+>)?\s*:/;
        // Standard function: Name<specifiers>(params)<effects>:
        const functionPattern = /^(\w+)((?:<[^>]+>)*)\s*\([^)]*\)\s*(?:<[^>]+>)*\s*:/;
        // Extension method: (Type:type).Name<specifiers>(params)<effects>:
        const extensionMethodPattern = /^\([^)]+\)\.(\w+)((?:<[^>]+>)*)\s*\([^)]*\)/;
        const variablePattern = /^(\w+)((?:<[^>]+>)*)\s*:/;

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const line = rawLine.trim();

            // Skip comments and empty lines
            if (line === "" || line.startsWith("#") || line.startsWith("//")) {
                continue;
            }

            // Skip using statements
            if (line.startsWith("using")) {
                continue;
            }

            // Calculate indentation (spaces or tabs converted to spaces)
            const indentMatch = rawLine.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1].replace(/\t/g, "    ").length : 0;

            // Pop modules from stack when indentation decreases
            while (moduleStack.length > 0 && indent <= moduleStack[moduleStack.length - 1].indent) {
                moduleStack.pop();
            }
            currentModulePath = moduleStack.length > 0 ? moduleStack[moduleStack.length - 1].name : "";

            // Check for module declaration
            const moduleMatch = line.match(modulePattern);
            if (moduleMatch) {
                const [, name, specifiers] = moduleMatch;
                const visibility = extractVisibility(specifiers);
                const isPublic = visibility === "public";

                if (shouldSkipDeclaration(visibility, true)) {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;
                moduleStack.push({ name: fullPath, indent });
                currentModulePath = fullPath;

                nodes.push({
                    name,
                    fullPath,
                    type: "module",
                    isPublic,
                    sourceFile: filePath,
                    sourceLine: i + 1,
                });
                continue;
            }

            // Check for class declaration
            const classMatch = line.match(classPattern);
            if (classMatch) {
                const [, name, specifiers] = classMatch;
                const visibility = extractVisibility(specifiers);
                const isPublic = visibility === "public";

                if (shouldSkipDeclaration(visibility)) {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "class",
                    isPublic,
                    sourceFile: filePath,
                    sourceLine: i + 1,
                });
                continue;
            }

            // Check for struct declaration
            const structMatch = line.match(structPattern);
            if (structMatch) {
                const [, name, specifiers] = structMatch;
                const visibility = extractVisibility(specifiers);
                const isPublic = visibility === "public";

                if (shouldSkipDeclaration(visibility)) {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "struct",
                    isPublic,
                    sourceFile: filePath,
                    sourceLine: i + 1,
                });
                continue;
            }

            // Check for interface declaration
            const interfaceMatch = line.match(interfacePattern);
            if (interfaceMatch) {
                const [, name, specifiers] = interfaceMatch;
                const visibility = extractVisibility(specifiers);
                const isPublic = visibility === "public";

                if (shouldSkipDeclaration(visibility)) {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "interface",
                    isPublic,
                    sourceFile: filePath,
                    sourceLine: i + 1,
                });
                continue;
            }

            // Check for enum declaration
            const enumMatch = line.match(enumPattern);
            if (enumMatch) {
                const [, name, specifiers] = enumMatch;
                const visibility = extractVisibility(specifiers);
                const isPublic = visibility === "public";

                if (shouldSkipDeclaration(visibility)) {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "enum",
                    isPublic,
                    sourceFile: filePath,
                    sourceLine: i + 1,
                });
                continue;
            }

            // Check for extension method first (before regular function)
            const extensionMatch = line.match(extensionMethodPattern);
            if (extensionMatch) {
                const [, name, specifiers] = extensionMatch;
                const visibility = extractVisibility(specifiers);
                const isPublic = visibility === "public";

                if (shouldSkipDeclaration(visibility)) {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "function",
                    isPublic,
                    sourceFile: filePath,
                    sourceLine: i + 1,
                });
                continue;
            }

            // Check for function declaration
            const functionMatch = line.match(functionPattern);
            if (functionMatch) {
                const [, name, specifiers] = functionMatch;
                const visibility = extractVisibility(specifiers);
                const isPublic = visibility === "public";

                if (shouldSkipDeclaration(visibility)) {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "function",
                    isPublic,
                    sourceFile: filePath,
                    sourceLine: i + 1,
                });
                continue;
            }

            // Check for variable declaration (should be last to avoid false positives)
            const variableMatch = line.match(variablePattern);
            if (variableMatch) {
                const [, name, specifiers] = variableMatch;
                const visibility = extractVisibility(specifiers);
                const isPublic = visibility === "public";

                if (shouldSkipDeclaration(visibility)) {
                    continue;
                }

                // Skip if it looks like a function or type definition
                if (line.includes(":=") && (line.includes("class") || line.includes("struct") || line.includes("module") || line.includes("interface") || line.includes("enum"))) {
                    continue;
                }

                // Skip if it's a function (has parentheses before the colon)
                if (/\([^)]*\)\s*(?:<[^>]+>)?\s*:/.test(line)) {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "variable",
                    isPublic,
                    sourceFile: filePath,
                    sourceLine: i + 1,
                });
            }
        }

        return nodes;
    }
}
