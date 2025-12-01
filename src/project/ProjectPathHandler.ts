import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { logger } from "../utils";

interface UEFNProjectFile {
    bindings?: {
        projectVersePath?: string;
        projectId?: string;
        modules?: Record<string, string>;
    };
    title?: string;
    plugins?: Array<{
        name: string;
        bIsRoot?: boolean;
        bIsPublic?: boolean;
    }>;
}

export class ProjectPathHandler {
    private projectVersePath: string | null = null;
    private projectName: string | null = null;
    private cachedProjectFile: UEFNProjectFile | null = null;

    constructor(private outputChannel: vscode.OutputChannel) {}

    /**
     * Finds and parses the .uefnproject file in the workspace
     * @returns The parsed project file or null if not found
     */
    async findAndParseProjectFile(): Promise<UEFNProjectFile | null> {
        if (this.cachedProjectFile) {
            return this.cachedProjectFile;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            logger.debug("ProjectPathHandler", "No workspace folders found");
            return null;
        }

        for (const folder of workspaceFolders) {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "*.uefnproject"), null, 1);

            if (files.length > 0) {
                const projectFilePath = files[0].fsPath;
                logger.debug("ProjectPathHandler", `Found .uefnproject file at: ${projectFilePath}`);

                try {
                    const content = fs.readFileSync(projectFilePath, "utf8");
                    this.cachedProjectFile = JSON.parse(content) as UEFNProjectFile;

                    if (this.cachedProjectFile.bindings?.projectVersePath) {
                        this.projectVersePath = this.cachedProjectFile.bindings.projectVersePath;
                        logger.debug("ProjectPathHandler", `Project Verse path: ${this.projectVersePath}`);
                    }

                    if (this.cachedProjectFile.title) {
                        this.projectName = this.cachedProjectFile.title;
                    }

                    return this.cachedProjectFile;
                } catch (error) {
                    logger.debug("ProjectPathHandler", `Error parsing .uefnproject file: ${error}`);
                    return null;
                }
            }
        }

        const firstWorkspace = workspaceFolders[0];
        let currentDir = firstWorkspace.uri.fsPath;
        const maxLevels = 5;

        for (let level = 0; level < maxLevels; level++) {
            const parentDir = path.dirname(currentDir);

            if (parentDir === currentDir) {
                break;
            }

            try {
                const globPattern = new vscode.RelativePattern(vscode.Uri.file(parentDir), "*.uefnproject");
                const files = await vscode.workspace.findFiles(globPattern, null, 1);

                if (files.length > 0) {
                    const projectFilePath = files[0].fsPath;
                    logger.debug("ProjectPathHandler", `Found .uefnproject file in parent directory (${level + 1} level(s) up): ${projectFilePath}`);

                    const content = fs.readFileSync(projectFilePath, "utf8");
                    this.cachedProjectFile = JSON.parse(content) as UEFNProjectFile;

                    if (this.cachedProjectFile.bindings?.projectVersePath) {
                        this.projectVersePath = this.cachedProjectFile.bindings.projectVersePath;
                        logger.debug("ProjectPathHandler", `Project Verse path: ${this.projectVersePath}`);
                    }

                    if (this.cachedProjectFile.title) {
                        this.projectName = this.cachedProjectFile.title;
                    }

                    return this.cachedProjectFile;
                }
            } catch (error) {
                logger.debug("ProjectPathHandler", `Error searching parent directory at level ${level + 1}: ${error}`);
            }

            currentDir = parentDir;
        }

        logger.debug("ProjectPathHandler", "No .uefnproject file found in workspace or parent directories (checked up to 5 levels)");
        return null;
    }

    /**
     * Gets the project's Verse path (e.g., /vuke@fortnite.com/Highjacked)
     */
    async getProjectVersePath(): Promise<string | null> {
        if (this.projectVersePath) {
            return this.projectVersePath;
        }

        const projectFile = await this.findAndParseProjectFile();
        return projectFile?.bindings?.projectVersePath || null;
    }

    /**
     * Gets the project name from the .uefnproject file
     */
    async getProjectName(): Promise<string | null> {
        if (this.projectName) {
            return this.projectName;
        }

        const projectFile = await this.findAndParseProjectFile();
        return projectFile?.title || null;
    }

    /**
     * Gets the modules defined in the project
     */
    async getProjectModules(): Promise<Record<string, string> | null> {
        const projectFile = await this.findAndParseProjectFile();
        return projectFile?.bindings?.modules || null;
    }

    /**
     * Clears the cached project file
     */
    clearCache(): void {
        this.cachedProjectFile = null;
        this.projectVersePath = null;
        this.projectName = null;
        logger.debug("ProjectPathHandler", "Cleared project path cache");
    }

    /**
     * Watches for changes to .uefnproject files
     */
    setupFileWatcher(): vscode.Disposable {
        const watcher = vscode.workspace.createFileSystemWatcher("**/*.uefnproject");

        const clearCacheHandler = () => {
            this.clearCache();
            logger.debug("ProjectPathHandler", "Project file changed, cache cleared");
        };

        watcher.onDidChange(clearCacheHandler);
        watcher.onDidCreate(clearCacheHandler);
        watcher.onDidDelete(clearCacheHandler);

        return watcher;
    }
}
