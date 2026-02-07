import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { logger } from "../utils";
import { ProjectPathHandler } from "../project";

/**
 * Parses the project's Assets.digest.verse file to extract class names.
 * This is used to determine the correct module boundary when inferring imports
 * from "Did you mean X.Y.Z.ClassName" error messages.
 */
export class AssetsDigestParser {
    private classNames: Set<string> = new Set();
    private lastParsed: number = 0;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    private cachedDigestPath: string | null = null;
    private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes (aligned with DigestParser)

    constructor(
        private outputChannel: vscode.OutputChannel,
        private projectPathHandler: ProjectPathHandler
    ) {}

    /**
     * Gets the path to the project's Assets.digest.verse file.
     * Location: {LOCALAPPDATA}\UnrealEditorFortnite\Saved\VerseProject\{ProjectName}\{ProjectName}-Assets\Assets.digest.verse
     */
    async getAssetsDigestPath(): Promise<string | null> {
        if (this.cachedDigestPath && fs.existsSync(this.cachedDigestPath)) {
            return this.cachedDigestPath;
        }

        const projectName = await this.projectPathHandler.getProjectName();
        if (!projectName) {
            logger.debug("AssetsDigestParser", "Project name not found, cannot locate Assets.digest.verse");
            return null;
        }

        // Get LocalAppData path
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

        // Try primary path structure (newer UEFN versions)
        const primaryPath = path.join(
            localAppData,
            "UnrealEditorFortnite",
            "Saved",
            "VerseProject",
            projectName,
            `${projectName}-Assets`,
            "Assets.digest.verse"
        );

        if (fs.existsSync(primaryPath)) {
            logger.debug("AssetsDigestParser", `Found Assets.digest.verse at: ${primaryPath}`);
            this.cachedDigestPath = primaryPath;
            return primaryPath;
        }

        // Try fallback path structure (older UEFN versions)
        const fallbackPath = path.join(
            localAppData,
            "UnrealEditorFortnite",
            "Saved",
            "VerseProject",
            projectName,
            "Assets.digest.verse"
        );

        if (fs.existsSync(fallbackPath)) {
            logger.debug("AssetsDigestParser", `Found Assets.digest.verse at fallback location: ${fallbackPath}`);
            this.cachedDigestPath = fallbackPath;
            return fallbackPath;
        }

        logger.debug("AssetsDigestParser", `Assets.digest.verse not found for project: ${projectName}`);
        logger.trace("AssetsDigestParser", `Tried paths:\n  - ${primaryPath}\n  - ${fallbackPath}`);
        return null;
    }

    /**
     * Parses the Assets.digest.verse file and extracts class names.
     */
    async parseAssetsDigest(): Promise<void> {
        const now = Date.now();
        if (this.classNames.size > 0 && now - this.lastParsed < this.CACHE_DURATION) {
            logger.trace("AssetsDigestParser", "Using cached asset class names");
            return;
        }

        const digestPath = await this.getAssetsDigestPath();
        if (!digestPath) {
            return;
        }

        try {
            logger.debug("AssetsDigestParser", `Parsing Assets.digest.verse: ${digestPath}`);
            const content = fs.readFileSync(digestPath, "utf8");
            const lines = content.split("\n");

            this.classNames.clear();

            for (const line of lines) {
                const trimmedLine = line.trim();

                // Skip comments and empty lines
                if (trimmedLine.startsWith("#") || trimmedLine === "") {
                    continue;
                }

                // Match class declarations: ClassName<public> := class or ClassName<internal> := class
                const classMatch = trimmedLine.match(/^(\w+)<(?:public|internal|private)>\s*:=\s*class/);
                if (classMatch) {
                    const className = classMatch[1];
                    this.classNames.add(className);
                    logger.trace("AssetsDigestParser", `Found asset class: ${className}`);
                    continue;
                }

                // Also match struct declarations as they behave similarly
                const structMatch = trimmedLine.match(/^(\w+)<(?:public|internal|private)>\s*:=\s*struct/);
                if (structMatch) {
                    const structName = structMatch[1];
                    this.classNames.add(structName);
                    logger.trace("AssetsDigestParser", `Found asset struct: ${structName}`);
                }
            }

            this.lastParsed = now;
            logger.info("AssetsDigestParser", `Parsed ${this.classNames.size} class/struct names from Assets.digest.verse`);
        } catch (error) {
            logger.error("AssetsDigestParser", `Error parsing Assets.digest.verse: ${digestPath}`, error);
        }
    }

    /**
     * Checks if a name is a known asset class name (synchronous, uses cache).
     * Call parseAssetsDigest() first to ensure cache is populated.
     */
    isAssetClassName(name: string): boolean {
        return this.classNames.has(name);
    }

    /**
     * Checks if a name is a known asset class name (async, ensures cache is fresh).
     */
    async isAssetClassNameAsync(name: string): Promise<boolean> {
        await this.parseAssetsDigest();
        return this.classNames.has(name);
    }

    /**
     * Ensures the cache is populated. Call this during initialization.
     */
    async ensureCachePopulated(): Promise<void> {
        await this.parseAssetsDigest();
    }

    /**
     * Gets all known asset class names (for debugging).
     */
    getAssetClassNames(): Set<string> {
        return new Set(this.classNames);
    }

    /**
     * Clears the cache and forces a re-parse on next access.
     */
    clearCache(): void {
        this.classNames.clear();
        this.lastParsed = 0;
        this.cachedDigestPath = null;
        logger.debug("AssetsDigestParser", "Cache cleared");
    }

    /**
     * Sets up a file watcher for the Assets.digest.verse file.
     * The file changes when assets are modified in UEFN.
     */
    setupFileWatcher(): vscode.Disposable {
        // Create a composite disposable to hold multiple watchers
        const disposables: vscode.Disposable[] = [];

        // Watch for Assets.digest.verse in the VerseProject folder
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
        const watchPattern = path.join(
            localAppData,
            "UnrealEditorFortnite",
            "Saved",
            "VerseProject",
            "**",
            "Assets.digest.verse"
        );

        // Use a glob pattern for the watcher
        const watcher = vscode.workspace.createFileSystemWatcher(watchPattern);

        const handleChange = (uri: vscode.Uri) => {
            logger.debug("AssetsDigestParser", `Assets.digest.verse changed: ${uri.fsPath}`);
            this.clearCache();
        };

        watcher.onDidChange(handleChange);
        watcher.onDidCreate(handleChange);
        watcher.onDidDelete(handleChange);

        disposables.push(watcher);

        // Also watch for .uefnproject changes to clear cached path
        const projectWatcher = vscode.workspace.createFileSystemWatcher("**/*.uefnproject");
        projectWatcher.onDidChange(() => {
            logger.debug("AssetsDigestParser", "Project file changed, clearing digest path cache");
            this.cachedDigestPath = null;
        });
        disposables.push(projectWatcher);

        this.fileWatcher = watcher;

        return vscode.Disposable.from(...disposables);
    }
}
