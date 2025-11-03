import * as vscode from "vscode";
import { ImportHandler } from "./importHandler";
import { log } from "../utils/logging";

interface QuickPickItemWithAction extends vscode.QuickPickItem {
    action?: () => void | Promise<void>;
}

export class StatusBarHandler {
    private statusBarItem: vscode.StatusBarItem;
    private snoozeEndTime: number | null = null;
    private snoozeInterval: NodeJS.Timeout | null = null;

    constructor(
        private outputChannel: vscode.OutputChannel,
        private importHandler: ImportHandler
    ) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = "verseAutoImports.showStatusMenu";
        this.updateStatusBarDisplay();
        this.statusBarItem.show();

        // Listen for configuration changes to update status bar
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("verseAutoImports")) {
                this.updateStatusBarDisplay();
            }
        });
    }

    getStatusBarItem(): vscode.StatusBarItem {
        return this.statusBarItem;
    }

    private updateStatusBarDisplay(): void {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const autoImportEnabled = config.get<boolean>("autoImport", true);

        if (this.snoozeEndTime !== null) {
            // Snooze is active - show countdown
            const remaining = this.getRemainingTime();
            this.statusBarItem.text = `$(clock) Verse (${remaining})`;
            this.statusBarItem.tooltip = `Auto imports snoozed (${remaining} remaining)`;
        } else if (!autoImportEnabled) {
            // Auto import disabled
            this.statusBarItem.text = "$(circle-slash) Verse";
            this.statusBarItem.tooltip = "Verse Auto Imports (disabled)";
        } else {
            // Normal state
            this.statusBarItem.text = "$(symbol-namespace) Verse";
            this.statusBarItem.tooltip = "Verse Auto Imports";
        }
    }

    private getRemainingTime(): string {
        if (this.snoozeEndTime === null) return "0:00";

        const now = Date.now();
        const remaining = Math.max(0, this.snoozeEndTime - now);
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    async showMenu(): Promise<void> {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const autoImportEnabled = config.get<boolean>("autoImport", true);
        const preserveLocations = config.get<boolean>("preserveImportLocations", false);
        const useDigestFiles = config.get<boolean>("useDigestFiles", false);
        const importSyntax = config.get<string>("importSyntax", "curly");

        const items: QuickPickItemWithAction[] = [];

        // Optimize Imports button
        items.push({
            label: "$(file-code) Optimize Imports",
            description: "Sort and organize imports in current file",
            action: async () => {
                await vscode.commands.executeCommand("verseAutoImports.optimizeImports");
            }
        });

        // Separator
        items.push({
            label: "",
            kind: vscode.QuickPickItemKind.Separator
        });

        // Auto Import checkbox
        items.push({
            label: autoImportEnabled ? "$(check) Auto Import" : "$(blank) Auto Import",
            description: autoImportEnabled ? "Enabled" : "Disabled",
            action: async () => {
                await config.update("autoImport", !autoImportEnabled, vscode.ConfigurationTarget.Global);
                log(this.outputChannel, `Auto import toggled: ${!autoImportEnabled}`);
            }
        });

        // Preserve Import Locations checkbox
        items.push({
            label: preserveLocations ? "$(check) Preserve Import Locations" : "$(blank) Preserve Import Locations",
            description: preserveLocations ? "Keep imports in place" : "Consolidate at top",
            action: async () => {
                await config.update("preserveImportLocations", !preserveLocations, vscode.ConfigurationTarget.Global);
                log(this.outputChannel, `Preserve import locations toggled: ${!preserveLocations}`);
            }
        });

        // Import Syntax checkbox
        const isDotSyntax = importSyntax === "dot";
        items.push({
            label: isDotSyntax ? "$(check) Dot Syntax (using.)" : "$(blank) Dot Syntax (using.)",
            description: isDotSyntax ? "using. /Path" : "using { /Path }",
            action: async () => {
                const newSyntax = isDotSyntax ? "curly" : "dot";
                await config.update("importSyntax", newSyntax, vscode.ConfigurationTarget.Global);
                log(this.outputChannel, `Import syntax changed to: ${newSyntax}`);
            }
        });

        // Use Digest Files checkbox (experimental)
        items.push({
            label: useDigestFiles ? "$(check) Use Digest Files" : "$(blank) Use Digest Files",
            description: useDigestFiles ? "⚠️ Experimental - Enabled" : "⚠️ Experimental - Disabled",
            action: async () => {
                await config.update("useDigestFiles", !useDigestFiles, vscode.ConfigurationTarget.Global);
                log(this.outputChannel, `Use digest files toggled: ${!useDigestFiles}`);
            }
        });

        // Separator
        items.push({
            label: "",
            kind: vscode.QuickPickItemKind.Separator
        });

        // Snooze section
        if (this.snoozeEndTime !== null) {
            // Snooze is active - show timer and controls
            const remaining = this.getRemainingTime();

            items.push({
                label: "$(add) Add 5 Minutes",
                description: `${remaining} remaining`,
                action: () => {
                    this.extendSnooze(5);
                }
            });

            items.push({
                label: "$(close) Cancel Snooze",
                description: "Resume auto imports immediately",
                action: () => {
                    this.cancelSnooze();
                }
            });
        } else {
            // Snooze is not active - show snooze button
            items.push({
                label: "$(clock) Snooze",
                description: "Turn off auto imports for 5 mins",
                action: () => {
                    this.startSnooze(5);
                }
            });
        }

        // Separator
        items.push({
            label: "",
            kind: vscode.QuickPickItemKind.Separator
        });

        // Utility actions
        items.push({
            label: "$(output) View Output Logs",
            description: "Open extension output channel",
            action: () => {
                this.outputChannel.show();
            }
        });

        items.push({
            label: "$(settings-gear) Open Extension Settings",
            description: "View all Verse Auto Imports settings",
            action: async () => {
                await vscode.commands.executeCommand("workbench.action.openSettings", "verseAutoImports");
            }
        });

        // Show the menu
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: "Verse Auto Imports - Quick Actions",
            matchOnDescription: true
        });

        // Execute the action if an item was selected
        if (selected?.action) {
            await selected.action();
            // Refresh the menu after action (optional - can be removed if too chatty)
            // await this.showMenu();
        }
    }

    private startSnooze(minutes: number): void {
        log(this.outputChannel, `Starting snooze for ${minutes} minutes`);

        // Set snooze end time
        this.snoozeEndTime = Date.now() + (minutes * 60 * 1000);

        // Disable auto imports
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        config.update("autoImport", false, vscode.ConfigurationTarget.Global);

        // Start countdown interval (update every 30 seconds)
        this.snoozeInterval = setInterval(() => {
            if (this.snoozeEndTime && Date.now() >= this.snoozeEndTime) {
                this.endSnooze();
            } else {
                this.updateStatusBarDisplay();
            }
        }, 30000); // Update every 30 seconds

        // Update immediately
        this.updateStatusBarDisplay();

        vscode.window.showInformationMessage(
            `Auto imports snoozed for ${minutes} minutes`
        );
    }

    private extendSnooze(minutes: number): void {
        if (this.snoozeEndTime === null) return;

        log(this.outputChannel, `Extending snooze by ${minutes} minutes`);
        this.snoozeEndTime += minutes * 60 * 1000;
        this.updateStatusBarDisplay();

        vscode.window.showInformationMessage(
            `Snooze extended by ${minutes} minutes`
        );
    }

    private cancelSnooze(): void {
        log(this.outputChannel, "Cancelling snooze");

        // Clear snooze state
        this.snoozeEndTime = null;
        if (this.snoozeInterval) {
            clearInterval(this.snoozeInterval);
            this.snoozeInterval = null;
        }

        // Re-enable auto imports
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        config.update("autoImport", true, vscode.ConfigurationTarget.Global);

        this.updateStatusBarDisplay();

        vscode.window.showInformationMessage("Auto imports resumed");
    }

    private endSnooze(): void {
        log(this.outputChannel, "Snooze timer expired");

        // Clear snooze state
        this.snoozeEndTime = null;
        if (this.snoozeInterval) {
            clearInterval(this.snoozeInterval);
            this.snoozeInterval = null;
        }

        // Re-enable auto imports
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        config.update("autoImport", true, vscode.ConfigurationTarget.Global);

        this.updateStatusBarDisplay();

        vscode.window.showInformationMessage("Auto imports resumed automatically");
    }

    dispose(): void {
        if (this.snoozeInterval) {
            clearInterval(this.snoozeInterval);
        }
        this.statusBarItem.dispose();
    }
}
