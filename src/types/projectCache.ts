/**
 * Type definitions for the Project Path Cache system.
 * Used to cache and quickly look up project module structure.
 */

/**
 * Version of the persisted cache format. Bumping this invalidates previously
 * stored caches (they are rebuilt on next activation). Shared by the scanner
 * that stamps payloads and the cache that validates them.
 */
export const PROJECT_CACHE_VERSION = "2";

/**
 * A single declaration found in a .verse file.
 */
export interface ProjectPathNode {
    /** The identifier name */
    name: string;

    /**
     * Dot-chain of enclosing explicit module declarations within the source
     * file, ending in this declaration's name (e.g. "Outer.Inner" for a
     * module Inner declared inside module Outer, or just "Inner" for a
     * top-level declaration). This reflects nesting inside the file only;
     * folder structure is not part of it.
     */
    fullPath: string;

    /** The type of declaration */
    type: "module" | "class" | "struct" | "function" | "variable" | "interface" | "enum";

    /** Whether this declaration is public */
    isPublic: boolean;

    /** Relative path to the source .verse file (from workspace root, "/" separators) */
    sourceFile?: string;

    /** Line number in the source file where this declaration starts */
    sourceLine?: number;
}

/**
 * The scanned project declaration data held by the cache.
 * All lookup indexes are derived from `nodes` and are not persisted.
 */
export interface ProjectPathData {
    /** The project Verse path */
    projectVersePath: string;

    /** The project name from .uefnproject */
    projectName: string;

    /** Timestamp when this data was generated */
    generatedAt: number;

    /** Every declaration found in the project, flat */
    nodes: ProjectPathNode[];
}

/**
 * Persisted shape of the cache in VS Code workspace storage.
 */
export interface SerializedProjectPathCache extends ProjectPathData {
    /** Format version; payloads with a different version are discarded */
    version: string;
}

/**
 * Options for scanning the project for declarations.
 */
export interface ProjectScanOptions {
    /** File patterns to include */
    includePatterns?: string[];

    /** File patterns to exclude */
    excludePatterns?: string[];

    /** Whether to include private declarations */
    includePrivate?: boolean;

    /** Progress callback for UI feedback */
    onProgress?: (current: number, total: number, file: string) => void;
}
