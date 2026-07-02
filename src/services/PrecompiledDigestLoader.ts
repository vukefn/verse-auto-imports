import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { logger } from "../utils";
import { DigestEntry } from "./DigestParser";

/**
 * Structure of the pre-compiled JSON digest files
 */
export interface PrecompiledDigest {
    version: string;
    generatedAt: string;
    sourceFile: string;
    sourceBuild: string;
    entries: Record<string, DigestEntry>;
    moduleIndex: Record<string, string[]>;
}

/**
 * Loads pre-compiled JSON digest files for fast runtime access.
 * These files are generated at build time by src/scripts/parseDigestFiles.ts
 */
export class PrecompiledDigestLoader {
    private digestCache: Map<string, DigestEntry> = new Map();
    private moduleIndex: Map<string, string[]> = new Map();
    private loaded: boolean = false;
    private loadError: Error | null = null;

    private static readonly DIGEST_FILES = ["Fortnite.digest.json", "UnrealEngine.digest.json", "Verse.digest.json"];

    constructor(private extensionContext: vscode.ExtensionContext) {}

    /**
     * Load all pre-compiled digest files into memory.
     * Call this once during extension activation.
     */
    async loadPrecompiledDigests(): Promise<void> {
        if (this.loaded) {
            return;
        }

        const startTime = Date.now();
        logger.debug("PrecompiledDigestLoader", "Loading pre-compiled digest files...");

        try {
            const extensionPath = this.extensionContext.extensionPath;
            const dataDir = path.join(extensionPath, "src", "data");
            let successCount = 0;

            // Check if data directory exists
            if (!fs.existsSync(dataDir)) {
                // Try out directory for compiled extension
                const outDataDir = path.join(extensionPath, "out", "data");
                if (fs.existsSync(outDataDir)) {
                    successCount = await this.loadFromDirectory(outDataDir);
                } else {
                    throw new Error(`Pre-compiled digest directory not found: ${dataDir}`);
                }
            } else {
                successCount = await this.loadFromDirectory(dataDir);
            }

            // Only mark as loaded if at least one file was successfully parsed
            if (successCount > 0) {
                this.loaded = true;
                const elapsed = Date.now() - startTime;
                logger.info("PrecompiledDigestLoader", `Loaded ${this.digestCache.size} entries from ${successCount} pre-compiled digest file(s) in ${elapsed}ms`);
            } else {
                throw new Error("No digest files were successfully loaded");
            }
        } catch (error) {
            this.loadError = error instanceof Error ? error : new Error(String(error));
            logger.error("PrecompiledDigestLoader", "Failed to load pre-compiled digests", error);
            throw this.loadError;
        }
    }

    /**
     * Load digest files from a directory
     * @returns number of successfully loaded files
     */
    private async loadFromDirectory(dataDir: string): Promise<number> {
        let successCount = 0;

        for (const fileName of PrecompiledDigestLoader.DIGEST_FILES) {
            const filePath = path.join(dataDir, fileName);

            if (!fs.existsSync(filePath)) {
                logger.warn("PrecompiledDigestLoader", `Digest file not found: ${filePath}`);
                continue;
            }

            try {
                const content = fs.readFileSync(filePath, "utf8");
                const digest: PrecompiledDigest = JSON.parse(content);

                // Merge entries into cache
                for (const [identifier, entry] of Object.entries(digest.entries)) {
                    if (!this.digestCache.has(identifier)) {
                        this.digestCache.set(identifier, entry);
                    }
                }

                // Merge module index using Set for efficiency
                for (const [modulePath, identifiers] of Object.entries(digest.moduleIndex)) {
                    const existingSet = new Set(this.moduleIndex.get(modulePath) || []);
                    for (const id of identifiers) {
                        existingSet.add(id);
                    }
                    this.moduleIndex.set(modulePath, Array.from(existingSet));
                }

                successCount++;
                logger.trace("PrecompiledDigestLoader", `Loaded ${Object.keys(digest.entries).length} entries from ${fileName}`);
            } catch (error) {
                logger.error("PrecompiledDigestLoader", `Failed to parse ${fileName}`, error);
            }
        }

        return successCount;
    }

    /**
     * Get a digest entry by identifier
     */
    getEntry(identifier: string): DigestEntry | undefined {
        return this.digestCache.get(identifier);
    }

    /**
     * Get all identifiers in a module
     */
    getModuleIdentifiers(modulePath: string): string[] {
        return this.moduleIndex.get(modulePath) || [];
    }

    /**
     * Get all loaded entries as a Map (compatible with DigestParser interface)
     */
    getAllEntries(): Map<string, DigestEntry> {
        return this.digestCache;
    }

    /**
     * Check if the loader has successfully loaded data
     */
    isLoaded(): boolean {
        return this.loaded;
    }

    /**
     * Get the load error if loading failed
     */
    getLoadError(): Error | null {
        return this.loadError;
    }

    /**
     * Get statistics about loaded data
     */
    getStats(): { entries: number; modules: number; loaded: boolean } {
        return {
            entries: this.digestCache.size,
            modules: this.moduleIndex.size,
            loaded: this.loaded,
        };
    }

    /**
     * Clear all cached data and reset loaded state
     */
    clear(): void {
        this.digestCache.clear();
        this.moduleIndex.clear();
        this.loaded = false;
        this.loadError = null;
        logger.debug("PrecompiledDigestLoader", "Cache cleared");
    }
}
