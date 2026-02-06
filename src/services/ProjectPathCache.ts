import * as vscode from "vscode";
import { logger } from "../utils";
import { ProjectPathHandler } from "../project";
import { ProjectPathTreeBuilder } from "./ProjectPathTreeBuilder";
import {
    ProjectPathTree,
    ProjectPathNode,
    CacheMetadata,
    CacheLookupResult,
    SerializedProjectPathTree,
} from "../types";

/**
 * Manages the project path tree cache with VS Code workspace storage.
 * Provides fast lookups and automatic cache invalidation via file watchers.
 */
export class ProjectPathCache {
    private tree: ProjectPathTree | null = null;
    private metadata: CacheMetadata | null = null;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    private pendingUpdates: Set<string> = new Set();
    private updateDebounceTimer: NodeJS.Timeout | null = null;
    private identifierIndex: Map<string, ProjectPathNode[]> = new Map();
    private initialized: boolean = false;

    private static readonly CACHE_KEY = "projectPathTree";
    private static readonly METADATA_KEY = "projectPathTreeMeta";
    private static readonly CACHE_VERSION = "1.0.0";
    private static readonly DEBOUNCE_MS = 500;

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel,
        private projectPathHandler: ProjectPathHandler
    ) {}

    /**
     * Initialize the cache - load from storage or build fresh.
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const startTime = Date.now();
        logger.info("ProjectPathCache", "Initializing project path cache...");

        try {
            // Try to load from storage first
            const loaded = await this.loadFromStorage();

            if (loaded) {
                logger.info("ProjectPathCache", `Loaded cache from storage in ${Date.now() - startTime}ms`);
            } else {
                // Build fresh cache
                logger.info("ProjectPathCache", "No valid cache found, building fresh...");
                await this.rebuildCache();
            }

            this.initialized = true;
        } catch (error) {
            logger.error("ProjectPathCache", "Failed to initialize cache", error);
        }
    }

    /**
     * Get the cached path tree.
     */
    getTree(): ProjectPathTree | null {
        return this.tree;
    }

    /**
     * Look up an identifier in the path tree.
     */
    lookupIdentifier(identifier: string): CacheLookupResult {
        const matches = this.identifierIndex.get(identifier.toLowerCase()) || [];

        return {
            identifier,
            matches,
            fromCache: true,
        };
    }

    /**
     * Find all identifiers in a module path.
     */
    getModuleContents(modulePath: string): ProjectPathNode[] {
        if (!this.tree) {
            return [];
        }

        const normalizedPath = modulePath.toLowerCase();
        const results: ProjectPathNode[] = [];

        const search = (node: ProjectPathNode) => {
            if (node.fullPath.toLowerCase() === normalizedPath) {
                results.push(...node.children);
            }
            for (const child of node.children) {
                search(child);
            }
        };

        search(this.tree.root);
        return results;
    }

    /**
     * Look up a module path and return matching nodes.
     */
    lookupModulePath(modulePath: string): string[] {
        if (!this.tree) {
            return [];
        }

        const normalizedPath = modulePath.toLowerCase().replace(/^\//, "");
        const results: string[] = [];

        const search = (node: ProjectPathNode) => {
            const nodePath = node.fullPath.toLowerCase().replace(/^\//, "");
            if (nodePath === normalizedPath || nodePath.endsWith(normalizedPath)) {
                results.push(node.fullPath);
            }
            for (const child of node.children) {
                search(child);
            }
        };

        search(this.tree.root);
        return results;
    }

    /**
     * Force a full cache rebuild.
     */
    async rebuildCache(): Promise<void> {
        const startTime = Date.now();
        logger.info("ProjectPathCache", "Rebuilding project path cache...");

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                logger.warn("ProjectPathCache", "No workspace folders found");
                return;
            }

            const treeBuilder = new ProjectPathTreeBuilder(this.outputChannel, this.projectPathHandler);
            const tree = await treeBuilder.buildFullTree(workspaceFolders[0]);

            if (tree) {
                this.tree = tree;
                this.buildIdentifierIndex();
                this.updateMetadata();
                await this.saveToStorage();

                logger.info(
                    "ProjectPathCache",
                    `Cache rebuilt: ${this.identifierIndex.size} identifiers in ${Date.now() - startTime}ms`
                );
            }
        } catch (error) {
            logger.error("ProjectPathCache", "Failed to rebuild cache", error);
        }
    }

    /**
     * Invalidate cache for specific files.
     */
    async invalidateFiles(filePaths: string[]): Promise<void> {
        if (!this.tree) {
            return;
        }

        logger.debug("ProjectPathCache", `Invalidating ${filePaths.length} files`);

        for (const filePath of filePaths) {
            // Remove old entries for this file
            const oldIdentifiers = this.tree.fileIndex[filePath] || [];
            for (const identifier of oldIdentifiers) {
                const nodes = this.identifierIndex.get(identifier.toLowerCase());
                if (nodes) {
                    const filtered = nodes.filter((n) => n.sourceFile !== filePath);
                    if (filtered.length > 0) {
                        this.identifierIndex.set(identifier.toLowerCase(), filtered);
                    } else {
                        this.identifierIndex.delete(identifier.toLowerCase());
                    }
                }
            }

            // Remove from tree
            this.tree.root.children = this.tree.root.children.filter(
                (child) => child.sourceFile !== filePath
            );

            delete this.tree.fileIndex[filePath];
        }

        // Reparse the files
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        const treeBuilder = new ProjectPathTreeBuilder(this.outputChannel, this.projectPathHandler);

        for (const filePath of filePaths) {
            try {
                const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
                const nodes = await treeBuilder.parseVerseFile(fileUri, workspaceFolders[0]);

                if (nodes.length > 0) {
                    this.tree.fileIndex[filePath] = nodes.map((n) => n.name);
                    this.tree.root.children.push(...nodes);

                    // Update identifier index
                    for (const node of nodes) {
                        const key = node.name.toLowerCase();
                        const existing = this.identifierIndex.get(key) || [];
                        existing.push(node);
                        this.identifierIndex.set(key, existing);
                    }
                }
            } catch (error) {
                logger.error("ProjectPathCache", `Failed to reparse ${filePath}`, error);
            }
        }

        this.tree.generatedAt = Date.now();
        await this.saveToStorage();
    }

    /**
     * Set up file watchers for .verse files.
     */
    setupFileWatchers(): vscode.Disposable {
        const disposables: vscode.Disposable[] = [];

        // Watch for .verse file changes
        this.fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.verse");

        this.fileWatcher.onDidChange((uri) => this.handleFileChange(uri));
        this.fileWatcher.onDidCreate((uri) => this.handleFileChange(uri));
        this.fileWatcher.onDidDelete((uri) => this.handleFileDelete(uri));

        disposables.push(this.fileWatcher);

        logger.debug("ProjectPathCache", "File watchers set up");

        return vscode.Disposable.from(...disposables);
    }

    /**
     * Get cache statistics.
     */
    getStats(): {
        loaded: boolean;
        identifiers: number;
        files: number;
        generatedAt: number | null;
    } {
        return {
            loaded: this.tree !== null,
            identifiers: this.identifierIndex.size,
            files: this.tree ? Object.keys(this.tree.fileIndex).length : 0,
            generatedAt: this.tree?.generatedAt || null,
        };
    }

    /**
     * Clear all cached data.
     */
    clear(): void {
        this.tree = null;
        this.metadata = null;
        this.identifierIndex.clear();
        this.pendingUpdates.clear();

        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
            this.updateDebounceTimer = null;
        }

        logger.debug("ProjectPathCache", "Cache cleared");
    }

    /**
     * Save cache to VS Code workspace storage.
     */
    private async saveToStorage(): Promise<void> {
        if (!this.tree) {
            return;
        }

        try {
            const serialized: SerializedProjectPathTree = {
                version: this.tree.version,
                projectVersePath: this.tree.projectVersePath,
                projectName: this.tree.projectName,
                generatedAt: this.tree.generatedAt,
                root: this.tree.root,
                fileIndex: this.tree.fileIndex,
            };

            await this.context.workspaceState.update(ProjectPathCache.CACHE_KEY, serialized);
            await this.context.workspaceState.update(ProjectPathCache.METADATA_KEY, this.metadata);

            logger.debug("ProjectPathCache", "Cache saved to workspace storage");
        } catch (error) {
            logger.error("ProjectPathCache", "Failed to save cache", error);
        }
    }

    /**
     * Load cache from VS Code workspace storage.
     */
    private async loadFromStorage(): Promise<boolean> {
        try {
            const serialized = this.context.workspaceState.get<SerializedProjectPathTree>(
                ProjectPathCache.CACHE_KEY
            );
            const metadata = this.context.workspaceState.get<CacheMetadata>(
                ProjectPathCache.METADATA_KEY
            );

            if (!serialized || !metadata) {
                return false;
            }

            // Check version compatibility
            if (serialized.version !== ProjectPathCache.CACHE_VERSION) {
                logger.info("ProjectPathCache", "Cache version mismatch, will rebuild");
                return false;
            }

            // Check if project name matches
            const currentProjectName = await this.projectPathHandler.getProjectName();
            if (currentProjectName && serialized.projectName !== currentProjectName) {
                logger.info("ProjectPathCache", "Project name mismatch, will rebuild");
                return false;
            }

            this.tree = {
                version: serialized.version,
                projectVersePath: serialized.projectVersePath,
                projectName: serialized.projectName,
                generatedAt: serialized.generatedAt,
                root: serialized.root,
                fileIndex: serialized.fileIndex,
            };
            this.metadata = metadata;

            this.buildIdentifierIndex();

            logger.debug(
                "ProjectPathCache",
                `Loaded ${this.identifierIndex.size} identifiers from storage`
            );

            return true;
        } catch (error) {
            logger.error("ProjectPathCache", "Failed to load cache from storage", error);
            return false;
        }
    }

    /**
     * Build identifier index from tree for fast lookups.
     */
    private buildIdentifierIndex(): void {
        this.identifierIndex.clear();

        if (!this.tree) {
            return;
        }

        const indexNode = (node: ProjectPathNode) => {
            const key = node.name.toLowerCase();
            const existing = this.identifierIndex.get(key) || [];
            existing.push(node);
            this.identifierIndex.set(key, existing);

            for (const child of node.children) {
                indexNode(child);
            }
        };

        indexNode(this.tree.root);
    }

    /**
     * Update cache metadata.
     */
    private updateMetadata(): void {
        if (!this.tree) {
            return;
        }

        this.metadata = {
            cacheVersion: ProjectPathCache.CACHE_VERSION,
            lastFullScan: Date.now(),
            fileCount: Object.keys(this.tree.fileIndex).length,
            identifierCount: this.identifierIndex.size,
            fileHashes: {},
        };
    }

    /**
     * Handle file change events with debouncing.
     */
    private handleFileChange(uri: vscode.Uri): void {
        const relativePath = vscode.workspace.asRelativePath(uri, false);
        this.pendingUpdates.add(relativePath);

        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }

        this.updateDebounceTimer = setTimeout(async () => {
            const filesToUpdate = Array.from(this.pendingUpdates);
            this.pendingUpdates.clear();

            logger.debug("ProjectPathCache", `Processing ${filesToUpdate.length} file changes`);
            await this.invalidateFiles(filesToUpdate);
        }, ProjectPathCache.DEBOUNCE_MS);
    }

    /**
     * Handle file delete events.
     */
    private handleFileDelete(uri: vscode.Uri): void {
        const relativePath = vscode.workspace.asRelativePath(uri, false);

        if (!this.tree) {
            return;
        }

        // Remove from tree
        const oldIdentifiers = this.tree.fileIndex[relativePath] || [];
        for (const identifier of oldIdentifiers) {
            const nodes = this.identifierIndex.get(identifier.toLowerCase());
            if (nodes) {
                const filtered = nodes.filter((n) => n.sourceFile !== relativePath);
                if (filtered.length > 0) {
                    this.identifierIndex.set(identifier.toLowerCase(), filtered);
                } else {
                    this.identifierIndex.delete(identifier.toLowerCase());
                }
            }
        }

        this.tree.root.children = this.tree.root.children.filter(
            (child) => child.sourceFile !== relativePath
        );

        delete this.tree.fileIndex[relativePath];

        // Save asynchronously
        this.saveToStorage().catch((error) => {
            logger.error("ProjectPathCache", "Failed to save after file delete", error);
        });

        logger.debug("ProjectPathCache", `Removed ${relativePath} from cache`);
    }
}
