/**
 * Type definitions for the Project Path Cache system.
 * Used to cache and quickly look up project module structure.
 */

/**
 * Represents a node in the project path tree.
 * Each node corresponds to a Verse module, class, struct, function, or variable.
 */
export interface ProjectPathNode {
    /** The identifier name */
    name: string;

    /** The full Verse path */
    fullPath: string;

    /** The type of declaration */
    type: "module" | "class" | "struct" | "function" | "variable" | "interface" | "enum";

    /** Whether this declaration is public */
    isPublic: boolean;

    /** Child nodes (for modules containing other declarations) */
    children: ProjectPathNode[];

    /** Relative path to the source .verse file (from workspace root) */
    sourceFile?: string;

    /** Line number in the source file where this declaration starts */
    sourceLine?: number;

    /** Last modification timestamp of the source file when this node was created */
    sourceFileModified?: number;
}

/**
 * Represents the complete project path tree.
 * Cached in VS Code workspace storage.
 */
export interface ProjectPathTree {
    /** Version of the cache format (for migration) */
    version: string;

    /** The project Verse path */
    projectVersePath: string;

    /** The project name from .uefnproject */
    projectName: string;

    /** Timestamp when this tree was generated */
    generatedAt: number;

    /** Root node containing all top-level modules */
    root: ProjectPathNode;

    /** Index mapping file paths to identifiers defined in them (for incremental updates) */
    fileIndex: Record<string, string[]>;
}

/**
 * Metadata about the cache state.
 * Used to validate and manage cache freshness.
 */
export interface CacheMetadata {
    /** Version of the cache format */
    cacheVersion: string;

    /** Timestamp of the last full scan */
    lastFullScan: number;

    /** Number of files scanned */
    fileCount: number;

    /** Total number of identifiers cached */
    identifierCount: number;

    /** Hash of file paths and their modification times for quick invalidation check */
    fileHashes: Record<string, number>;
}

/**
 * Result of looking up an identifier in the cache.
 */
export interface CacheLookupResult {
    /** The identifier that was looked up */
    identifier: string;

    /** Matching nodes found in the cache */
    matches: ProjectPathNode[];

    /** Whether the result came from cache or required a fresh scan */
    fromCache: boolean;
}

/**
 * Options for building/rebuilding the project path tree.
 */
export interface TreeBuildOptions {
    /** Maximum depth to traverse */
    maxDepth?: number;

    /** File patterns to include */
    includePatterns?: string[];

    /** File patterns to exclude */
    excludePatterns?: string[];

    /** Whether to include private declarations */
    includePrivate?: boolean;

    /** Progress callback for UI feedback */
    onProgress?: (current: number, total: number, file: string) => void;
}

/**
 * Serializable version of ProjectPathTree for storage.
 * Used because Maps and Sets do not serialize to JSON directly.
 */
export interface SerializedProjectPathTree {
    version: string;
    projectVersePath: string;
    projectName: string;
    generatedAt: number;
    root: ProjectPathNode;
    fileIndex: Record<string, string[]>;
}
