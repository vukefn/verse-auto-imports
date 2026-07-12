import * as vscode from "vscode";

/**
 * Handles import formatting, syntax preferences, grouping, and path utilities.
 */
export class ImportFormatter {
    /**
     * Determines if a line is a module import (as opposed to a local-scope `using`).
     *
     * `using` has two meanings in Verse:
     * - Module import: `using { /Verse.org/Simulation }`, `using { game_systems.inventory }`
     * - Local-scope using: `using{Variable}` — brings an instance's members into scope
     *
     * Verse supports three equivalent syntactic styles for `using`:
     * - Braced:   `using { /Verse.org/Simulation }`
     * - Dotted:   `using. /Verse.org/Simulation`
     * - Indented: `using:` followed by an indented path on the next line
     *
     * All three styles can express either a module import or a local-scope using.
     * Detection is content-based: paths (starting with `/`) and dot-notation module
     * references (containing `.`) indicate module imports. Bare identifiers indicate
     * local-scope using.
     *
     * @param line The line to check
     * @param nextLine The following line in the document (needed for indented style
     *   where the content is on the next line). When not provided and the line is
     *   `using:`, conservatively returns `true`.
     */
    static isModuleImport(line: string, nextLine?: string): boolean {
        const trimmed = line.trim();
        if (!trimmed.startsWith("using")) {
            return false;
        }

        // Indented style: using:
        //     /Verse.org/Simulation
        // Content is on the next line — use nextLine for content-based detection.
        if (/^using\s*:\s*$/.test(trimmed)) {
            if (nextLine !== undefined) {
                const content = nextLine.trim();
                if (content.startsWith("/")) {
                    return true;
                }
                if (content.includes(".")) {
                    return true;
                }
                return false;
            }
            // Without next line context, conservatively assume module import
            return true;
        }

        // Dotted style: using. <content>
        const dotMatch = trimmed.match(/^using\.\s+(.+)/);
        if (dotMatch) {
            const content = dotMatch[1].trim();
            if (content.startsWith("/")) {
                return true;
            }
            if (content.includes(".")) {
                return true;
            }
            return false;
        }

        // Braced style: using { /path } or using{Variable}
        const curlyMatch = trimmed.match(/^using\s*\{\s*([^}]+)\s*\}/);
        if (curlyMatch) {
            const content = curlyMatch[1].trim();
            if (content.startsWith("/")) {
                return true;
            }
            if (content.includes(".")) {
                return true;
            }
            return false;
        }

        return false;
    }

    /**
     * Formats an import statement using the specified syntax.
     * @param path The module path to import
     * @param useDotSyntax Whether to use dot syntax (using. /path) or curly syntax (using { /path })
     */
    formatImportStatement(path: string, useDotSyntax: boolean): string {
        return useDotSyntax ? `using. ${path.trim()}` : `using { ${path.trim()} }`;
    }

    /**
     * Extracts the module path from an import statement.
     * Handles both curly syntax (using { /path }) and dot syntax (using. /path).
     * @param importStatement The full import statement
     * @returns The extracted path or null if not found
     */
    extractPathFromImport(importStatement: string): string | null {
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
     * Determines if an import is a digest import (from Verse.org, Fortnite.com, or UnrealEngine.com).
     * @param importPath The import path or statement to check
     * @returns true if the import is from a digest source, false otherwise
     */
    isDigestImport(importPath: string): boolean {
        // Extract the path if this is a full import statement
        let path = importPath;
        if (importPath.includes("using")) {
            path = this.extractPathFromImport(importPath) || importPath;
        }

        // Get configurable digest prefixes
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const digestPrefixes = config.get<string[]>("behavior.digestImportPrefixes", ["/Verse.org/", "/Fortnite.com/", "/UnrealEngine.com/"]);

        // Check if it's a digest import
        return digestPrefixes.some((prefix) => path.startsWith(prefix));
    }

    /**
     * Sorts import paths for a `using` block using rank-based ordering rather
     * than plain alphabetical order.
     *
     * Verse resolves `using` statements top-down: a statement can only see
     * identifiers brought into scope by statements above it. This matters
     * because `using` has two meanings — a module import (`using { /Path }`,
     * `using { Foo.Bar }`) and a local-scope using (`using { Variable }`) —
     * and a dotted module import's first segment is itself only in scope if
     * some other import (a bare module reference) already provided it. For
     * example `using { Economy.Shop }` needs `Economy` in scope, which
     * `using { Features }` provides if `Features` declares the `Economy`
     * submodule. Plain alphabetical sorting can reorder `Economy.Shop` before
     * `Features` (E < F) and break compilation even though both imports are
     * individually valid.
     *
     * Paths are grouped into three ranks, and only alphabetized within a rank:
     * - Rank 0 — absolute paths (start with `/`): self-contained, sorted alphabetically.
     * - Rank 1 — bare identifiers (no `/`, no `.`): kept in their original
     *   input order, never alphabetized, since the relative order between
     *   bare module imports is semantic — a nested child must follow the
     *   parent that provides it.
     * - Rank 2 — everything else (dotted references such as `Economy.Shop`,
     *   and any other non-absolute form): sorted alphabetically.
     *
     * A lower rank always precedes a higher rank, so bare imports precede
     * dotted ones, guaranteeing a provider precedes anything that might
     * depend on it. The sort is stable, so rank 1 entries keep their input
     * order (the comparator returns 0 for two rank-1 paths).
     *
     * @param paths Import paths to sort
     * @returns A new array with paths ordered by rank, then alphabetically within rank 0 and rank 2
     */
    sortImportsByRank(paths: string[]): string[] {
        const rankOf = (path: string): number => {
            if (path.startsWith("/")) {
                return 0;
            }
            if (!path.includes(".") && !path.includes("/")) {
                return 1;
            }
            return 2;
        };

        return [...paths].sort((a, b) => {
            const rankDifference = rankOf(a) - rankOf(b);
            if (rankDifference !== 0) {
                return rankDifference;
            }
            if (rankOf(a) === 1) {
                // Bare identifiers keep their input order; relative order is semantic.
                return 0;
            }
            return a.localeCompare(b);
        });
    }

    /**
     * Groups and formats imports based on the configuration settings.
     * @param importPaths Array of import paths to group and format
     * @param preferDotSyntax Whether to use dot syntax for imports
     * @param sortAlphabetically Whether to sort imports alphabetically
     * @param importGrouping The grouping strategy ('none', 'digestFirst', or 'localFirst')
     * @returns Array of formatted import statements with potential empty lines for grouping
     */
    groupAndFormatImports(importPaths: string[], preferDotSyntax: boolean, sortAlphabetically: boolean, importGrouping: string): string[] {
        if (importGrouping === "none") {
            // Rank-based sort if enabled (see sortImportsByRank for why plain
            // alphabetical order is unsafe for local imports)
            const sortedPaths = sortAlphabetically ? this.sortImportsByRank(importPaths) : importPaths;
            return sortedPaths.map((path) => this.formatImportStatement(path, preferDotSyntax));
        }

        // New grouping behavior: separate digest and local imports
        let digestImports: string[] = [];
        let localImports: string[] = [];

        for (const path of importPaths) {
            if (this.isDigestImport(path)) {
                digestImports.push(path);
            } else {
                localImports.push(path);
            }
        }

        // Sort within groups if enabled. digestImports are always absolute
        // paths, so rank sort and plain alphabetical sort are equivalent
        // there; the same helper is used for both groups for consistency.
        if (sortAlphabetically) {
            digestImports = this.sortImportsByRank(digestImports);
            localImports = this.sortImportsByRank(localImports);
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
}
