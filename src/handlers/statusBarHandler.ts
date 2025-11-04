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
        this.statusBarItem.name = "Verse Auto Imports";

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
        if (this.snoozeEndTime !== null) {
            // Snooze is active - show text with countdown
            const remaining = this.getRemainingTime();
            this.statusBarItem.text = `Auto Imports (${remaining})`;
        } else {
            // Normal state - just show text
            this.statusBarItem.text = "Auto Imports";
        }

        // Update tooltip with rich markdown
        this.updateTooltip();
    }

    private updateTooltip(): void {
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        const autoImportEnabled = config.get<boolean>("general.autoImport", true);
        const preserveLocations = config.get<boolean>("behavior.preserveImportLocations", false);
        const importSyntax = config.get<string>("behavior.importSyntax", "curly");
        const useDigestFiles = config.get<boolean>("experimental.useDigestFiles", false);

        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportThemeIcons = true;
        md.supportHtml = true;

        // Status indicators with theme colors
        const enabledBadge = '<span style="background-color:var(--vscode-button-background);color:var(--vscode-button-foreground);">&nbsp;ON&nbsp;</span>';
        const disabledBadge = '<span style="background-color:var(--vscode-errorForeground);color:var(--vscode-button-foreground);">&nbsp;OFF&nbsp;</span>';

        // Header
        md.appendMarkdown('<div style="padding:4px 0;">');
        md.appendMarkdown('<h3 style="margin:0 0 8px 0;">Verse Auto Imports</h3>');

        // Quick Actions Section
        md.appendMarkdown('<div style="margin-bottom:8px;">');
        md.appendMarkdown('<strong>Quick Actions:</strong><br>');
        md.appendMarkdown('<table style="border-collapse:collapse;margin-top:4px;">');

        // Optimize Imports
        md.appendMarkdown('<tr>');
        md.appendMarkdown('<td style="padding:2px 8px 2px 0;">');
        md.appendMarkdown('<a href="command:verseAutoImports.optimizeImports">$(file-code) Optimize Imports</a>');
        md.appendMarkdown('</td>');
        md.appendMarkdown('</tr>');

        // Snooze controls
        if (this.snoozeEndTime !== null) {
            const remaining = this.getRemainingTime();
            md.appendMarkdown('<tr>');
            md.appendMarkdown('<td style="padding:6px 8px 6px 0;">$(clock) Snoozed</td>');
            md.appendMarkdown(`<td style="padding:6px 0;"><span style="background-color:var(--vscode-editorWarning-background);color:var(--vscode-editorWarning-foreground);">&nbsp;&nbsp;${remaining}&nbsp;&nbsp;</span></td>`);
            md.appendMarkdown('</tr>');

            md.appendMarkdown('<tr>');
            md.appendMarkdown('<td colspan="2" style="padding:4px 0 2px 12px;">');
            md.appendMarkdown('<a href="command:verseAutoImports.snoozeAutoImport">$(add) Add 5 Minutes</a>');
            md.appendMarkdown('</td>');
            md.appendMarkdown('</tr>');

            md.appendMarkdown('<tr>');
            md.appendMarkdown('<td colspan="2" style="padding:2px 0 4px 12px;">');
            md.appendMarkdown('<a href="command:verseAutoImports.cancelSnooze">$(close) Cancel Snooze</a>');
            md.appendMarkdown('</td>');
            md.appendMarkdown('</tr>');
        } else {
            md.appendMarkdown('<tr>');
            md.appendMarkdown('<td style="padding:8px 0;">');
            md.appendMarkdown('<a href="command:verseAutoImports.snoozeAutoImport">$(clock) Snooze</a>');
            md.appendMarkdown('</td>');
            md.appendMarkdown('</tr>');
        }

        md.appendMarkdown('</table>');
        md.appendMarkdown('</div>');

        md.appendMarkdown('<hr style="margin:8px 0;border:none;border-top:1px solid #444;">');

        // Settings Section
        md.appendMarkdown('<div style="margin-bottom:8px;">');
        md.appendMarkdown('<strong>Settings:</strong><br>');
        md.appendMarkdown('<table style="border-collapse:collapse;margin-top:4px;width:100%;">');

        // Auto Import
        md.appendMarkdown('<tr>');
        md.appendMarkdown('<td style="padding:2px 8px 2px 0;">');
        md.appendMarkdown('<a href="command:verseAutoImports.toggleAutoImport">Toggle</a>');
        md.appendMarkdown('</td>');
        md.appendMarkdown('<td style="padding:2px 8px;width:100%;">Auto Import</td>');
        md.appendMarkdown(`<td style="padding:2px 0;text-align:right;white-space:nowrap;">${autoImportEnabled ? enabledBadge : disabledBadge}</td>`);
        md.appendMarkdown('</tr>');

        // Preserve Locations
        md.appendMarkdown('<tr>');
        md.appendMarkdown('<td style="padding:2px 8px 2px 0;">');
        md.appendMarkdown('<a href="command:verseAutoImports.togglePreserveLocations">Toggle</a>');
        md.appendMarkdown('</td>');
        md.appendMarkdown('<td style="padding:2px 8px;width:100%;">Preserve Locations</td>');
        md.appendMarkdown(`<td style="padding:2px 0;text-align:right;white-space:nowrap;">${preserveLocations ? enabledBadge : disabledBadge}</td>`);
        md.appendMarkdown('</tr>');

        // Import Syntax
        const syntaxDisplay = importSyntax === "curly" ? "using { }" : "using.";
        md.appendMarkdown('<tr>');
        md.appendMarkdown('<td style="padding:2px 8px 2px 0;">');
        md.appendMarkdown('<a href="command:verseAutoImports.toggleImportSyntax">Switch</a>');
        md.appendMarkdown('</td>');
        md.appendMarkdown(`<td style="padding:2px 8px;width:100%;">Import Syntax: <code>${syntaxDisplay}</code></td>`);
        md.appendMarkdown('<td style="padding:2px 0;"></td>');
        md.appendMarkdown('</tr>');

        // Path Conversion Helper
        const showCodeLens = config.get<boolean>("pathConversion.enableCodeLens", true);
        md.appendMarkdown('<tr>');
        md.appendMarkdown('<td style="padding:2px 8px 2px 0;">');
        md.appendMarkdown('<a href="command:verseAutoImports.toggleFullPathCodeLens">Toggle</a>');
        md.appendMarkdown('</td>');
        md.appendMarkdown('<td style="padding:2px 8px;width:100%;">Path Conversion Helper</td>');
        md.appendMarkdown(`<td style="padding:2px 0;text-align:right;white-space:nowrap;">${showCodeLens ? enabledBadge : disabledBadge}</td>`);
        md.appendMarkdown('</tr>');

        md.appendMarkdown('</table>');
        md.appendMarkdown('</div>');

        md.appendMarkdown('<hr style="margin:8px 0;border:none;border-top:1px solid #444;">');

        // Experimental Section
        md.appendMarkdown('<div style="margin-bottom:8px;">');
        md.appendMarkdown('<strong>Experimental:</strong><br>');
        md.appendMarkdown('<table style="border-collapse:collapse;margin-top:4px;width:100%;">');

        // Use Digest Files
        md.appendMarkdown('<tr>');
        md.appendMarkdown('<td style="padding:2px 8px 2px 0;">');
        md.appendMarkdown('<a href="command:verseAutoImports.toggleDigestFiles">Toggle</a>');
        md.appendMarkdown('</td>');
        md.appendMarkdown('<td style="padding:2px 8px;width:100%;">Use Digest Files</td>');
        md.appendMarkdown(`<td style="padding:2px 0;text-align:right;white-space:nowrap;">${useDigestFiles ? enabledBadge : disabledBadge}</td>`);
        md.appendMarkdown('</tr>');

        md.appendMarkdown('</table>');
        md.appendMarkdown('</div>');

        md.appendMarkdown('<hr style="margin:8px 0;border:none;border-top:1px solid #444;">');

        // Footer
        md.appendMarkdown('<div style="margin-top:8px;">');
        md.appendMarkdown('<a href="command:verseAutoImports.showStatusMenu">$(settings-gear) Open Full Menu</a> | ');
        md.appendMarkdown('<a href="command:workbench.action.output.toggleOutput">$(output) View Logs</a>');
        md.appendMarkdown('</div>');

        md.appendMarkdown('</div>');

        this.statusBarItem.tooltip = md;
    }

    updateDisplay(): void {
        this.updateStatusBarDisplay();
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
        const autoImportEnabled = config.get<boolean>("general.autoImport", true);
        const preserveLocations = config.get<boolean>("behavior.preserveImportLocations", false);
        const useDigestFiles = config.get<boolean>("experimental.useDigestFiles", false);
        const importSyntax = config.get<string>("behavior.importSyntax", "curly");
        const showCodeLens = config.get<boolean>("pathConversion.enableCodeLens", true);

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
                await config.update("general.autoImport", !autoImportEnabled, vscode.ConfigurationTarget.Global);
                log(this.outputChannel, `Auto import toggled: ${!autoImportEnabled}`);
            }
        });

        // Preserve Import Locations checkbox
        items.push({
            label: preserveLocations ? "$(check) Preserve Import Locations" : "$(blank) Preserve Import Locations",
            description: preserveLocations ? "Keep imports in place" : "Consolidate at top",
            action: async () => {
                await config.update("behavior.preserveImportLocations", !preserveLocations, vscode.ConfigurationTarget.Global);
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
                await config.update("behavior.importSyntax", newSyntax, vscode.ConfigurationTarget.Global);
                log(this.outputChannel, `Import syntax changed to: ${newSyntax}`);
            }
        });

        // Show Path Conversion CodeLens checkbox
        items.push({
            label: showCodeLens ? "$(check) Path Conversion Helper" : "$(blank) Path Conversion Helper",
            description: showCodeLens ? "Show on hover" : "Hidden",
            action: async () => {
                await config.update("pathConversion.enableCodeLens", !showCodeLens, vscode.ConfigurationTarget.Global);
                log(this.outputChannel, `Path conversion CodeLens toggled: ${!showCodeLens}`);
            }
        });

        // Use Digest Files checkbox (experimental)
        items.push({
            label: useDigestFiles ? "$(check) Use Digest Files" : "$(blank) Use Digest Files",
            description: useDigestFiles ? "⚠️ Experimental - Enabled" : "⚠️ Experimental - Disabled",
            action: async () => {
                await config.update("experimental.useDigestFiles", !useDigestFiles, vscode.ConfigurationTarget.Global);
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

    startSnooze(minutes: number): void {
        log(this.outputChannel, `Starting snooze for ${minutes} minutes`);

        // Set snooze end time
        this.snoozeEndTime = Date.now() + (minutes * 60 * 1000);

        // Disable auto imports
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        config.update("general.autoImport", false, vscode.ConfigurationTarget.Global);

        // Start countdown interval (update every second)
        this.snoozeInterval = setInterval(() => {
            if (this.snoozeEndTime && Date.now() >= this.snoozeEndTime) {
                this.endSnooze();
            } else {
                this.updateStatusBarDisplay();
            }
        }, 1000); // Update every second

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

    cancelSnooze(): void {
        log(this.outputChannel, "Cancelling snooze");

        // Clear snooze state
        this.snoozeEndTime = null;
        if (this.snoozeInterval) {
            clearInterval(this.snoozeInterval);
            this.snoozeInterval = null;
        }

        // Re-enable auto imports
        const config = vscode.workspace.getConfiguration("verseAutoImports");
        config.update("general.autoImport", true, vscode.ConfigurationTarget.Global);

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
        config.update("general.autoImport", true, vscode.ConfigurationTarget.Global);

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
