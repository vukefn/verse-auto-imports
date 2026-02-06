import * as vscode from "vscode";
import { logger } from "../utils";
import { ProjectPathHandler } from "../project";
import {
    ProjectPathNode,
    ProjectPathTree,
    TreeBuildOptions,
} from "../types";

/**
 * Builds a path tree by scanning all .verse files in the project.
 * Extracts module, class, struct, function, and variable declarations.
 */
export class ProjectPathTreeBuilder {
    private static readonly CACHE_VERSION = "1.0.0";

    constructor(
        private outputChannel: vscode.OutputChannel,
        private projectPathHandler: ProjectPathHandler
    ) {}

    /**
     * Builds a complete path tree by scanning all .verse files in the workspace.
     */
    async buildFullTree(
        workspaceFolder: vscode.WorkspaceFolder,
        options: TreeBuildOptions = {}
    ): Promise<ProjectPathTree | null> {
        const startTime = Date.now();
        logger.info("ProjectPathTreeBuilder", `Building path tree for ${workspaceFolder.name}...`);

        try {
            // Get project info
            const projectVersePath = await this.projectPathHandler.getProjectVersePath();
            const projectName = await this.projectPathHandler.getProjectName();

            if (!projectName) {
                logger.warn("ProjectPathTreeBuilder", "No UEFN project found in workspace");
                return null;
            }

            // Find all .verse files
            const includePattern = options.includePatterns?.[0] || "**/*.verse";
            const excludePatterns = options.excludePatterns || ["**/node_modules/**", "**/.git/**"];
            const excludePattern = `{${excludePatterns.join(",")}}`;

            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(workspaceFolder, includePattern),
                excludePattern
            );

            logger.debug("ProjectPathTreeBuilder", `Found ${files.length} .verse files`);

            // Build tree
            const root: ProjectPathNode = {
                name: projectName,
                fullPath: projectVersePath || `/${projectName}`,
                type: "module",
                isPublic: true,
                children: [],
            };

            const fileIndex: Record<string, string[]> = {};
            let processedCount = 0;

            for (const fileUri of files) {
                try {
                    const nodes = await this.parseVerseFile(fileUri, workspaceFolder, options);
                    const relativePath = vscode.workspace.asRelativePath(fileUri, false);

                    if (nodes.length > 0) {
                        fileIndex[relativePath] = nodes.map((n) => n.name);
                        this.mergeNodesIntoTree(root, nodes);
                    }

                    processedCount++;
                    if (options.onProgress) {
                        options.onProgress(processedCount, files.length, relativePath);
                    }
                } catch (error) {
                    logger.error("ProjectPathTreeBuilder", `Error parsing ${fileUri.fsPath}`, error);
                }
            }

            const tree: ProjectPathTree = {
                version: ProjectPathTreeBuilder.CACHE_VERSION,
                projectVersePath: projectVersePath || `/${projectName}`,
                projectName,
                generatedAt: Date.now(),
                root,
                fileIndex,
            };

            const elapsed = Date.now() - startTime;
            const totalNodes = this.countNodes(root);
            logger.info(
                "ProjectPathTreeBuilder",
                `Built path tree: ${totalNodes} nodes from ${files.length} files in ${elapsed}ms`
            );

            return tree;
        } catch (error) {
            logger.error("ProjectPathTreeBuilder", "Failed to build path tree", error);
            return null;
        }
    }

    /**
     * Parses a single .verse file and extracts declarations.
     */
    async parseVerseFile(
        fileUri: vscode.Uri,
        workspaceFolder: vscode.WorkspaceFolder,
        options: TreeBuildOptions = {}
    ): Promise<ProjectPathNode[]> {
        try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            const content = document.getText();
            const relativePath = vscode.workspace.asRelativePath(fileUri, false);

            return this.extractDeclarations(content, relativePath, options);
        } catch (error) {
            logger.error("ProjectPathTreeBuilder", `Failed to parse ${fileUri.fsPath}`, error);
            return [];
        }
    }

    /**
     * Extracts module, class, struct, and function declarations from Verse content.
     */
    extractDeclarations(
        content: string,
        filePath: string,
        options: TreeBuildOptions = {}
    ): ProjectPathNode[] {
        const nodes: ProjectPathNode[] = [];
        const lines = content.split("\n");

        // Track current module context
        let currentModulePath = "";
        const moduleStack: string[] = [];

        // Visibility specifiers in Verse: public, protected, private, internal, scoped
        const visibilitySpecifiers = "public|protected|private|internal|scoped";

        // Helper to extract visibility from specifier string like "<native><public>"
        const extractVisibility = (specifiers: string | undefined): string | undefined => {
            if (!specifiers) return undefined;
            const match = specifiers.match(new RegExp(`<(${visibilitySpecifiers})>`));
            return match ? match[1] : undefined;
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
            const line = lines[i].trim();

            // Skip comments and empty lines
            if (line === "" || line.startsWith("#") || line.startsWith("//")) {
                continue;
            }

            // Skip using statements
            if (line.startsWith("using")) {
                continue;
            }

            // Check for module declaration
            const moduleMatch = line.match(modulePattern);
            if (moduleMatch) {
                const [, name, specifiers] = moduleMatch;
                const visibility = extractVisibility(specifiers);
                const isPublic = visibility === "public";
                const isInternal = !visibility || visibility === "internal";

                // Skip private declarations unless includePrivate is set
                if (!options.includePrivate && visibility === "private") {
                    continue;
                }
                // By default, include public and internal (no visibility = internal)
                if (!options.includePrivate && !isPublic && !isInternal) {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;
                moduleStack.push(fullPath);
                currentModulePath = fullPath;

                nodes.push({
                    name,
                    fullPath,
                    type: "module",
                    isPublic,
                    children: [],
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

                // Skip private declarations unless includePrivate is set
                if (!options.includePrivate && visibility === "private") {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "class",
                    isPublic,
                    children: [],
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

                // Skip private declarations unless includePrivate is set
                if (!options.includePrivate && visibility === "private") {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "struct",
                    isPublic,
                    children: [],
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

                // Skip private declarations unless includePrivate is set
                if (!options.includePrivate && visibility === "private") {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "interface",
                    isPublic,
                    children: [],
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

                // Skip private declarations unless includePrivate is set
                if (!options.includePrivate && visibility === "private") {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "enum",
                    isPublic,
                    children: [],
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

                // Skip private declarations unless includePrivate is set
                if (!options.includePrivate && visibility === "private") {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "function",
                    isPublic,
                    children: [],
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

                // Skip private declarations unless includePrivate is set
                if (!options.includePrivate && visibility === "private") {
                    continue;
                }

                const fullPath = currentModulePath ? `${currentModulePath}.${name}` : name;

                nodes.push({
                    name,
                    fullPath,
                    type: "function",
                    isPublic,
                    children: [],
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

                // Skip private declarations unless includePrivate is set
                if (!options.includePrivate && visibility === "private") {
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
                    children: [],
                    sourceFile: filePath,
                    sourceLine: i + 1,
                });
            }
        }

        return nodes;
    }

    /**
     * Merges nodes into the tree structure.
     */
    private mergeNodesIntoTree(root: ProjectPathNode, nodes: ProjectPathNode[]): void {
        for (const node of nodes) {
            // For now, add all nodes as children of root
            // In a more sophisticated implementation, we'd build the hierarchy based on paths
            root.children.push(node);
        }
    }

    /**
     * Counts total nodes in the tree.
     */
    private countNodes(node: ProjectPathNode): number {
        let count = 1;
        for (const child of node.children) {
            count += this.countNodes(child);
        }
        return count;
    }
}
